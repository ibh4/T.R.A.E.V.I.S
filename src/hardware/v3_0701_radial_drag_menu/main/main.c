/* traepal_demo_round_ui - 圆屏 UI 离线演示版 (重写)
 * 功能:
 *   1. 连接页 (1.5s 自动) → 待机页 (idle_ready 动画循环 + "上滑进入菜单" 提示)
 *   2. 待机页: 播放 idle_ready 12 帧动画 (30ms/帧), 上滑进菜单
 *   3. 菜单页: 6 个圆形径向菜单按钮 (状态/蜘蛛/告警/能量/设置/关于)
 *   4. 状态页: 左右滑动切换 10 状态, 默认循环播放当前状态 12 帧动画
 *   5. 蜘蛛页: spider_bot 12 帧循环动画 (20ms/帧 = 50fps 加速)
 *   6. 告警页: bug_alert 12 帧 → fix_success 12 帧, 自动切换 (每 ~2.4s 切一次)
 *   7. 能量页: task_charge/thinking_scan/thinking_focus 12 帧轮播 (每 ~2.4s 切一次)
 *   8. 设置页: 假数据展示 (scale=2 大字)
 *   9. 关于页: 项目信息 (scale=2 大字, 修复 TraePal 只显示 tp 的问题)
 *  10. 任意页长按 800ms → 回待机页; 上滑返回上一级
 *  完全离线, 无 WiFi/BLE
 *
 * 资源格式:
 *   字库 (font 分区): 164 字 × 32×32 alpha mask = 1024 bytes/字, 偏移 index*1024
 *   状态动画 (states 分区): 60B 头 (10 状态 × 6B: offset:4B + frame_count:2B)
 *     + 10 状态 × 12 帧 × 240×240 RGB565 (115200 bytes/帧)
 *   ESP32 端近邻采样放大 240×240 → 466×466 显示
 */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp_log.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_touch.h"
#include "esp_partition.h"
#include "nvs_flash.h"
#include "bsp/esp-bsp.h"
#include "bsp/touch.h"
#include "bsp/display.h"

static const char *TAG = "TRAEPAL";

#define LCD_H_RES         466
#define LCD_V_RES         466
#define FRAME_BYTES       (LCD_H_RES * LCD_V_RES * 2)
#define CENTER_X          (LCD_H_RES / 2)
#define CENTER_Y          (LCD_V_RES / 2)
#define SCREEN_RADIUS     233

#define ANIM_W            240
#define ANIM_H            240
#define ANIM_FRAME_BYTES  (ANIM_W * ANIM_H * 2)   /* 115200 */
#define STATE_COUNT       10
#define FRAMES_PER_STATE  12

/* ========== Trae 黑绿配色 ========== */
#define COL_BLACK     0x0000
#define COL_WHITE     0xFFFF
#define COL_TRAE_GRN  0x07F0   /* Trae 绿 */
#define COL_BRIGHT_GR 0x2FFE   /* 亮绿 */
#define COL_DARK_GR   0x0120   /* 暗绿背景 */
#define COL_DEEP_BLK  0x0202   /* 深黑带绿调 */
#define COL_GRAY      0x4208
#define COL_DIM_GRAY  0x2104
#define COL_RED       0xF800
#define COL_YELLOW    0xFFE0
#define COL_CYAN      0x07FF

/* ========== 中文字符表 (164 字, 与 font_chars.txt 顺序一致, 32×32 alpha mask) ========== */
static const char *s_chinese_chars[] = {
    "药","物","研","发","智","能","体","集","合",                                /* 0-8 */
    "虚","拟","筛","选","分","子","设","计","蛋","白","构","象",                  /* 9-20 */
    "生","成","训","练","对","接","失","败","完","提","交","结","果",              /* 21-33 */
    "等","待","启","动","任","务","执","行","中","错","误","告","警","修","复","功", /* 34-49 */
    "运","重","跑","下","一","当","前","择","确","认","取","消","返","回","上","级", /* 50-65 */
    "主","菜","单","进","度","总","状","态","详","情",                            /* 66-75 */
    "项","目","离","线","版","本","关","于",                                      /* 76-83 */
    "数","据","准","备","模","型","评","估","参","优","化",                        /* 84-94 */
    "操","作","精","触","摸","滑","后","退","步",                                  /* 95-103 */
    "靶","点","预","测","亲","和","力","量",                                      /* 104-111 */
    "多","样","性","采",                                                         /* 112-115 */
    "试","演","示","应","用","系","统","置","间",                                  /* 116-124 */
    "连","机","入","页","面",                                                     /* 125-129 */
    "蜘","蛛","异","扫","描","聚","焦","脉","冲","荷",                            /* 130-139 */
    "休","眠","迷","宫","圆","形","屏","界",                                      /* 140-147 */
    "幕","式","画","帧","率","亮","硬","件",                                      /* 148-155 */
    "存","储","内","处","理","器","长","按",                                      /* 156-163 */
    "会","员","额","速","通","剩","余","已","升","实","际","支","付","抵","扣","到", /* 164-179 */
    "期","时","权","益","名","称","金","可","使","有","效","方","案","价","值","月", /* 180-195 */
    "年","日","次","今","星","二","三","四","五","六","秒","周","天","元",          /* 196-209 */
};
#define CHINESE_CHAR_COUNT (sizeof(s_chinese_chars) / sizeof(s_chinese_chars[0]))

/* ========== ASCII 字体 8×16 ========== */
static const uint8_t font8x16[96][16] = {
    {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x00,0x18,0x3C,0x3C,0x3C,0x18,0x18,0x18,0x00,0x18,0x18,0x00,0x00,0x00,0x00},
    {0x00,0x63,0x63,0x63,0x22,0x22,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x36,0x36,0x7F,0x36,0x36,0x36,0x7F,0x36,0x36,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x0C,0x3F,0x68,0x3E,0x0B,0x7F,0x0C,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x63,0x33,0x18,0x0C,0x06,0x33,0x63,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x18,0x3C,0x66,0x1C,0x36,0x63,0x7F,0x63,0x06,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x00,0x18,0x3C,0x3C,0x18,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x0E,0x1C,0x18,0x30,0x30,0x30,0x18,0x0C,0x0E,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x70,0x38,0x18,0x0C,0x0C,0x0C,0x18,0x30,0x70,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x00,0x00,0x66,0x3C,0xFF,0x3C,0x66,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x00,0x18,0x18,0x7E,0x18,0x18,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x18,0x18,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x00,0x00,0x00,0x00,0x7E,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x18,0x18,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x06,0x0C,0x18,0x30,0x60,0xC0,0x80,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x3C,0x66,0x66,0x66,0x66,0x66,0x66,0x66,0x3C,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x18,0x38,0x78,0x18,0x18,0x18,0x18,0x18,0x7E,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x3C,0x66,0x06,0x0C,0x18,0x30,0x60,0x66,0x7E,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x3C,0x66,0x06,0x1C,0x06,0x06,0x06,0x66,0x3C,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x0C,0x1C,0x3C,0x6C,0x7E,0x0C,0x0C,0x0C,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x7E,0x60,0x7C,0x06,0x06,0x06,0x06,0x66,0x3C,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x1C,0x30,0x60,0x7C,0x66,0x66,0x66,0x66,0x3C,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x7E,0x06,0x0C,0x18,0x30,0x30,0x30,0x30,0x30,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x3C,0x66,0x66,0x3C,0x66,0x66,0x66,0x66,0x3C,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x3C,0x66,0x66,0x66,0x3E,0x06,0x06,0x0C,0x38,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x00,0x00,0x18,0x18,0x00,0x00,0x18,0x18,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x00,0x00,0x18,0x18,0x00,0x00,0x18,0x18,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x06,0x0C,0x18,0x30,0x60,0x30,0x18,0x0C,0x06,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x00,0x00,0x7E,0x00,0x00,0x7E,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x60,0x30,0x18,0x0C,0x06,0x0C,0x18,0x30,0x60,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x3C,0x66,0x06,0x0C,0x18,0x18,0x00,0x18,0x18,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x3C,0x66,0x66,0x6E,0x6E,0x60,0x62,0x66,0x3C,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x18,0x3C,0x66,0x66,0x7E,0x66,0x66,0x66,0x66,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x7C,0x66,0x66,0x7C,0x66,0x66,0x66,0x66,0x7C,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x3C,0x66,0x60,0x60,0x60,0x60,0x60,0x66,0x3C,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x78,0x6C,0x66,0x66,0x66,0x66,0x66,0x6C,0x78,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x7E,0x60,0x60,0x7C,0x60,0x60,0x60,0x60,0x7E,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x7E,0x60,0x60,0x7C,0x60,0x60,0x60,0x60,0x60,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x3C,0x66,0x60,0x60,0x6E,0x66,0x66,0x66,0x3C,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x66,0x66,0x66,0x7E,0x66,0x66,0x66,0x66,0x66,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x7E,0x18,0x18,0x18,0x18,0x18,0x18,0x18,0x7E,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x06,0x06,0x06,0x06,0x06,0x06,0x66,0x66,0x3C,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x66,0x6C,0x78,0x70,0x78,0x6C,0x66,0x66,0x66,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x60,0x60,0x60,0x60,0x60,0x60,0x60,0x60,0x7E,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x63,0x77,0x7F,0x6B,0x63,0x63,0x63,0x63,0x63,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x66,0x76,0x7E,0x7E,0x6E,0x66,0x66,0x66,0x66,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x3C,0x66,0x66,0x66,0x66,0x66,0x66,0x66,0x3C,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x7C,0x66,0x66,0x7C,0x60,0x60,0x60,0x60,0x60,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x3C,0x66,0x66,0x66,0x66,0x66,0x3C,0x0E,0x1E,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x7C,0x66,0x66,0x7C,0x6C,0x66,0x66,0x66,0x66,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x3C,0x66,0x60,0x3C,0x06,0x06,0x66,0x66,0x3C,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x7E,0x18,0x18,0x18,0x18,0x18,0x18,0x18,0x18,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x66,0x66,0x66,0x66,0x66,0x66,0x66,0x66,0x3C,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x66,0x66,0x66,0x66,0x66,0x66,0x3C,0x3C,0x18,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x63,0x63,0x63,0x6B,0x7F,0x77,0x63,0x63,0x63,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x66,0x66,0x3C,0x18,0x18,0x3C,0x66,0x66,0x66,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x66,0x66,0x66,0x3C,0x18,0x18,0x18,0x18,0x18,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x7E,0x06,0x0C,0x18,0x30,0x60,0xC0,0x06,0x7E,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x3C,0x30,0x30,0x30,0x30,0x30,0x30,0x30,0x3C,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
    {0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00},
};

/* ========== 页面枚举 ========== */
typedef enum {
    PAGE_CONNECT = 0,
    PAGE_READY,
    PAGE_MENU,
    PAGE_STATUS,
    PAGE_SPIDER,
    PAGE_ALERT,
    PAGE_ENERGY,
    PAGE_SETTINGS,
    PAGE_ABOUT,
    PAGE_QUOTA,      /* 会员额度页 (Ready 右滑进入) */
    PAGE_COUNT
} page_t;

/* ========== 状态动画头 (60B: 10 状态 × 6B) ========== */
typedef struct __attribute__((packed)) {
    uint32_t offset;
    uint16_t frame_count;
} state_header_t;

/* ========== 全局状态 ========== */
static uint8_t *s_frame_buf = NULL;       /* 466×466 帧缓冲 */
static uint8_t *s_anim_buf_240 = NULL;    /* 240×240 动画帧缓冲 */
static esp_lcd_panel_handle_t s_panel = NULL;
static esp_lcd_touch_handle_t s_touch = NULL;
static SemaphoreHandle_t s_state_mutex = NULL;

/* 分区 */
static const esp_partition_t *s_font_part   = NULL;
static const esp_partition_t *s_states_part = NULL;

/* 状态头 */
static state_header_t s_state_headers[STATE_COUNT];

/* 页面状态 */
static page_t s_current_page = PAGE_CONNECT;
static int s_state_index = 0;       /* 状态页当前状态索引 (0-9) */

/* 动画帧索引 */
static int s_ready_frame  = 0;
static int s_status_frame = 0;
static int s_spider_frame = 0;
static int s_alert_frame  = 0;
static int s_energy_frame = 0;

/* 告警/能量轮播状态 */
static int s_alert_state  = 0;      /* 0=bug_alert(3), 1=fix_success(4) */
static int s_energy_state = 0;      /* 0=task_charge(6), 1=thinking_scan(1), 2=thinking_focus(2) */
static uint32_t s_last_anim_tick = 0;

/* 连接页计时 */
static uint32_t s_connect_start_tick = 0;

/* 菜单高亮 */
static int s_menu_highlight = -1;

/* 中心径向拖拽状态 */
static int s_drag_active = 0;        /* 0=未拖拽, 1=拖拽中 */
static int s_drag_idx = -1;          /* 当前高亮方向 -1~5 */
static int s_drag_start_x = 0, s_drag_start_y = 0;  /* 拖拽起点 */
#define DRAG_CENTER_RADIUS 60        /* 中心圆半径 (拖拽起点判定) */
#define DRAG_DEAD_ZONE 30            /* 死区, 避免抖动 */
#define DRAG_POP_OFFSET 16           /* 高亮项弹出距离 */

/* ========== 日期时间 (软件时钟, 模拟值, 不联网) ========== */
/* 基准时间: 2026/07/01 14:30:00 周三, 启动时以此为准, 之后按 tick 递增 */
typedef struct {
    int year, month, day, hour, min, sec;
    int weekday;  /* 0=周日 1=周一 ... 6=周六 */
} datetime_t;
static datetime_t s_dt = { 2026, 7, 1, 14, 30, 0, 3 };  /* 2026/07/01 周三 14:30 */
static uint32_t s_dt_last_tick = 0;

/* ========== 会员额度数据 (真实数据, 离线) ========== */
#define QUOTA_TOTAL      300    /* 总额度 */
#define QUOTA_USED       168    /* 已用 */
#define QUOTA_REMAIN     132    /* 剩余 */
#define QUOTA_USED_PCT   56     /* 已用占比 168/300=56% */
#define QUOTA_REMAIN_PCT 44     /* 剩余占比 132/300=44% */
/* 会员时间: 2026/06/20 22:12 支付, 2026/07/21 22:12 到期, 共31天, 已用11天, 剩20天 */
#define MEM_DAYS_TOTAL   31
#define MEM_DAYS_USED    11
#define MEM_DAYS_REMAIN  20
/* 升级到 Ultra 单月: ¥699.00, 抵扣 -¥105.96, 实付 ¥593.04 */
#define UPGRADE_PRICE    "699.00"
#define UPGRADE_DEDUCT   "105.96"
#define UPGRADE_PAY      "593.04"
static int s_quota_frame = 0;  /* 会员额度页动画帧 */

/* 10 状态名 (英文 + 中文) */
static const char *state_names[] = {
    "idle_ready", "thinking_scan", "thinking_focus", "bug_alert", "fix_success",
    "sync_ping", "task_charge", "spider_bot", "sleepy_nudge", "bug_maze"
};
static const char *state_cn_names[] = {
    "待机", "扫描", "聚焦", "告警", "修复",
    "脉冲", "任务", "蜘蛛", "休眠", "迷宫"
};

/* 能量页轮播状态索引 (task_charge, thinking_scan, thinking_focus) */
static const int energy_states[] = { 6, 1, 2 };
#define ENERGY_COUNT 3

/* ========== 菜单项数据 ========== */
typedef struct {
    int x, y;
    const char *cn_name;
    page_t target_page;
} menu_item_t;

static const menu_item_t s_menu_items[6] = {
    { 233, 103, "状态", PAGE_STATUS   },  /* 上 */
    { 363, 163, "蜘蛛", PAGE_SPIDER   },  /* 右上 */
    { 363, 303, "告警", PAGE_ALERT    },  /* 右下 */
    { 233, 363, "能量", PAGE_ENERGY   },  /* 下 */
    { 103, 303, "设置", PAGE_SETTINGS },  /* 左下 */
    { 103, 163, "关于", PAGE_ABOUT    },  /* 左上 */
};
#define MENU_BTN_RADIUS 50

/* ========== 字库函数 ========== */
/* 查找中文字符在字库中的索引 */
static int find_chinese_index(const char *utf8)
{
    for (int i = 0; i < (int)CHINESE_CHAR_COUNT; i++) {
        if (strncmp(utf8, s_chinese_chars[i], 3) == 0) return i;
    }
    return -1;
}

/* 画字符串 (中英混合 UTF-8), scale 放大, bold 加粗
 * 中文: 32×32 base, 每像素 scale×scale, advance = 32*scale
 * ASCII: 8×16 base, 每像素 scale×scale, advance = 8*scale
 * bold: 右邻+1像素, 下邻+1像素
 */
static int draw_text_sb(uint16_t *buf, const char *text, int x, int y, uint16_t color, int scale, int bold)
{
    int cx = x;
    while (*text) {
        uint8_t c = (uint8_t)*text;
        if (c < 0x80) {
            /* ASCII 8×16 */
            if (c < 32 || c > 127) c = '?';
            const uint8_t *glyph = font8x16[c - 32];
            for (int row = 0; row < 16; row++) {
                for (int col = 0; col < 8; col++) {
                    if (glyph[row] & (0x80 >> col)) {
                        for (int sy = 0; sy < scale; sy++) {
                            for (int sx = 0; sx < scale; sx++) {
                                int px = cx + col * scale + sx;
                                int py = y + row * scale + sy;
                                if (px >= 0 && px < LCD_H_RES && py >= 0 && py < LCD_V_RES)
                                    buf[py * LCD_H_RES + px] = color;
                                if (bold) {
                                    if (px + 1 < LCD_H_RES && py >= 0 && py < LCD_V_RES)
                                        buf[py * LCD_H_RES + px + 1] = color;
                                    if (px >= 0 && px < LCD_H_RES && py + 1 < LCD_V_RES)
                                        buf[(py + 1) * LCD_H_RES + px] = color;
                                }
                            }
                        }
                    }
                }
            }
            cx += 8 * scale;
            text++;
        } else if ((c & 0xF0) == 0xE0) {
            /* 中文 32×32 */
            int idx = find_chinese_index(text);
            if (idx >= 0 && s_font_part) {
                uint8_t mask[1024];
                if (esp_partition_read(s_font_part, (uint32_t)idx * 1024, mask, 1024) == ESP_OK) {
                    for (int row = 0; row < 32; row++) {
                        for (int col = 0; col < 32; col++) {
                            if (mask[row * 32 + col] > 80) {
                                for (int sy = 0; sy < scale; sy++) {
                                    for (int sx = 0; sx < scale; sx++) {
                                        int px = cx + col * scale + sx;
                                        int py = y + row * scale + sy;
                                        if (px >= 0 && px < LCD_H_RES && py >= 0 && py < LCD_V_RES)
                                            buf[py * LCD_H_RES + px] = color;
                                        if (bold) {
                                            if (px + 1 < LCD_H_RES && py >= 0 && py < LCD_V_RES)
                                                buf[py * LCD_H_RES + px + 1] = color;
                                            if (px >= 0 && px < LCD_H_RES && py + 1 < LCD_V_RES)
                                                buf[(py + 1) * LCD_H_RES + px] = color;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                cx += 32 * scale;
            } else {
                /* 字库中找不到, 画 ? */
                const uint8_t *glyph = font8x16['?' - 32];
                for (int row = 0; row < 16; row++) {
                    for (int col = 0; col < 8; col++) {
                        if (glyph[row] & (0x80 >> col)) {
                            for (int sy = 0; sy < scale; sy++) {
                                for (int sx = 0; sx < scale; sx++) {
                                    int px = cx + col * scale + sx;
                                    int py = y + row * scale + sy;
                                    if (px >= 0 && px < LCD_H_RES && py >= 0 && py < LCD_V_RES)
                                        buf[py * LCD_H_RES + px] = color;
                                }
                            }
                        }
                    }
                }
                cx += 8 * scale;
            }
            text += 3;
        } else if ((c & 0xE0) == 0xC0) {
            text += 2;
        } else {
            text++;
        }
    }
    return cx - x;
}

/* 计算字符串宽度 */
static int text_width_sb(const char *text, int scale)
{
    int w = 0;
    while (*text) {
        uint8_t c = (uint8_t)*text;
        if (c < 0x80) { w += 8 * scale; text++; }
        else if ((c & 0xF0) == 0xE0) { w += 32 * scale; text += 3; }
        else if ((c & 0xE0) == 0xC0) { w += 8 * scale; text += 2; }
        else text++;
    }
    return w;
}

/* 居中画字符串 */
static void draw_text_center_sb(uint16_t *buf, const char *text, int y, uint16_t color, int scale, int bold)
{
    int w = text_width_sb(text, scale);
    int x = (LCD_H_RES - w) / 2;
    draw_text_sb(buf, text, x, y, color, scale, bold);
}

/* ========== 几何绘图 ========== */
static void fill_rect(uint16_t *buf, int x, int y, int w, int h, uint16_t color)
{
    for (int r = y; r < y + h; r++) {
        if (r < 0 || r >= LCD_V_RES) continue;
        for (int c = x; c < x + w; c++) {
            if (c < 0 || c >= LCD_H_RES) continue;
            buf[r * LCD_H_RES + c] = color;
        }
    }
}

static void draw_hline(uint16_t *buf, int x1, int x2, int y, uint16_t color)
{
    if (y < 0 || y >= LCD_V_RES) return;
    if (x1 < 0) x1 = 0;
    if (x2 >= LCD_H_RES) x2 = LCD_H_RES - 1;
    for (int x = x1; x <= x2; x++) buf[y * LCD_H_RES + x] = color;
}

static void draw_vline(uint16_t *buf, int x, int y1, int y2, uint16_t color)
{
    if (x < 0 || x >= LCD_H_RES) return;
    if (y1 < 0) y1 = 0;
    if (y2 >= LCD_V_RES) y2 = LCD_V_RES - 1;
    for (int y = y1; y <= y2; y++) buf[y * LCD_H_RES + x] = color;
}

static void draw_line(uint16_t *buf, int x1, int y1, int x2, int y2, uint16_t color)
{
    int dx = abs(x2 - x1), dy = abs(y2 - y1);
    int sx = (x1 < x2) ? 1 : -1;
    int sy = (y1 < y2) ? 1 : -1;
    int err = dx - dy;
    int x = x1, y = y1;
    while (1) {
        if (x >= 0 && x < LCD_H_RES && y >= 0 && y < LCD_V_RES)
            buf[y * LCD_H_RES + x] = color;
        if (x == x2 && y == y2) break;
        int e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx)  { err += dx; y += sy; }
    }
}

static void draw_circle(uint16_t *buf, int cx, int cy, int r, uint16_t color)
{
    if (r <= 0) return;
    for (int angle = 0; angle < 360; angle++) {
        float rad = angle * M_PI / 180.0f;
        int x = cx + (int)(r * cosf(rad));
        int y = cy + (int)(r * sinf(rad));
        if (x >= 0 && x < LCD_H_RES && y >= 0 && y < LCD_V_RES)
            buf[y * LCD_H_RES + x] = color;
    }
}

static void fill_circle(uint16_t *buf, int cx, int cy, int r, uint16_t color)
{
    for (int y = -r; y <= r; y++) {
        for (int x = -r; x <= r; x++) {
            if (x * x + y * y <= r * r) {
                int px = cx + x, py = cy + y;
                if (px >= 0 && px < LCD_H_RES && py >= 0 && py < LCD_V_RES)
                    buf[py * LCD_H_RES + px] = color;
            }
        }
    }
}

static void draw_rounded_rect(uint16_t *buf, int x, int y, int w, int h, int r, uint16_t color)
{
    draw_hline(buf, x + r, x + w - r - 1, y, color);
    draw_hline(buf, x + r, x + w - r - 1, y + h - 1, color);
    draw_vline(buf, x, y + r, y + h - r - 1, color);
    draw_vline(buf, x + w - 1, y + r, y + h - r - 1, color);
    for (int dy = 0; dy < r; dy++) {
        for (int dx = 0; dx < r; dx++) {
            int dist2 = (r - 1 - dx) * (r - 1 - dx) + (r - 1 - dy) * (r - 1 - dy);
            if (dist2 < r * r && dist2 >= (r - 2) * (r - 2)) {
                int px, py;
                px = x + r - 1 - dx; py = y + r - 1 - dy;
                if (px >= 0 && px < LCD_H_RES && py >= 0 && py < LCD_V_RES) buf[py * LCD_H_RES + px] = color;
                px = x + w - r + dx; py = y + r - 1 - dy;
                if (px >= 0 && px < LCD_H_RES && py >= 0 && py < LCD_V_RES) buf[py * LCD_H_RES + px] = color;
                px = x + r - 1 - dx; py = y + h - r + dy;
                if (px >= 0 && px < LCD_H_RES && py >= 0 && py < LCD_V_RES) buf[py * LCD_H_RES + px] = color;
                px = x + w - r + dx; py = y + h - r + dy;
                if (px >= 0 && px < LCD_H_RES && py >= 0 && py < LCD_V_RES) buf[py * LCD_H_RES + px] = color;
            }
        }
    }
}

/* ========== 背景绘制: 黑绿径向渐变 + 绿色圆环 ========== */
static void draw_background(void)
{
    uint16_t *buf = (uint16_t *)s_frame_buf;
    for (int y = 0; y < LCD_V_RES; y++) {
        for (int x = 0; x < LCD_H_RES; x++) {
            int dx = x - CENTER_X;
            int dy = y - CENTER_Y;
            float dist = sqrtf((float)(dx * dx + dy * dy));
            float t = dist / SCREEN_RADIUS;
            if (t > 1.0f) t = 1.0f;
            uint8_t r1 = 0, g1 = 9, b1 = 0;   /* COL_DARK_GR 0x0120 */
            uint8_t r2 = 0, g2 = 1, b2 = 2;   /* COL_DEEP_BLK 0x0202 */
            uint8_t r = (uint8_t)(r1 + (r2 - r1) * t);
            uint8_t g = (uint8_t)(g1 + (g2 - g1) * t);
            uint8_t b = (uint8_t)(b1 + (b2 - b1) * t);
            if (dist > SCREEN_RADIUS) {
                buf[y * LCD_H_RES + x] = 0x0000;
            } else {
                buf[y * LCD_H_RES + x] = (uint16_t)((r << 11) | (g << 5) | b);
            }
        }
    }
    draw_circle(buf, CENTER_X, CENTER_Y, SCREEN_RADIUS - 1, COL_TRAE_GRN);
    draw_circle(buf, CENTER_X, CENTER_Y, SCREEN_RADIUS - 2, COL_DARK_GR);
}

/* ========== 分区初始化 ========== */
static void partitions_init(void)
{
    s_font_part = esp_partition_find_first(ESP_PARTITION_TYPE_DATA,
                                           ESP_PARTITION_SUBTYPE_DATA_UNDEFINED, "font");
    s_states_part = esp_partition_find_first(ESP_PARTITION_TYPE_DATA,
                                             ESP_PARTITION_SUBTYPE_DATA_UNDEFINED, "states");

    ESP_LOGI(TAG, "font:   %s", s_font_part   ? "OK" : "MISSING");
    ESP_LOGI(TAG, "states: %s", s_states_part ? "OK" : "MISSING");

    /* 读取 states 分区头 (60B: 10 状态 × 6B = offset:4B + frame_count:2B) */
    if (s_states_part) {
        esp_err_t ret = esp_partition_read(s_states_part, 0, s_state_headers,
                                           STATE_COUNT * sizeof(state_header_t));
        if (ret == ESP_OK) {
            for (int i = 0; i < STATE_COUNT; i++) {
                ESP_LOGI(TAG, "state[%d] %s: offset=%u frames=%u",
                         i, state_names[i],
                         (unsigned)s_state_headers[i].offset,
                         (unsigned)s_state_headers[i].frame_count);
            }
        } else {
            ESP_LOGE(TAG, "读取 states 头失败: %s", esp_err_to_name(ret));
        }
    }
}

/* ========== 状态动画帧加载 ========== */
/* 加载某状态某帧到 s_anim_buf_240 (240×240 RGB565) */
static bool load_state_frame(int state_idx, int frame_idx)
{
    if (!s_states_part || state_idx < 0 || state_idx >= STATE_COUNT) return false;
    uint16_t cnt = s_state_headers[state_idx].frame_count;
    if (cnt == 0) cnt = FRAMES_PER_STATE;  /* 兜底 */
    if (frame_idx >= cnt) return false;
    uint32_t off = s_state_headers[state_idx].offset + (uint32_t)frame_idx * ANIM_FRAME_BYTES;
    return esp_partition_read(s_states_part, off, s_anim_buf_240, ANIM_FRAME_BYTES) == ESP_OK;
}

/* ========== 近邻采样放大 240×240 → 466×466 ========== */
static void scale_frame_240_to_466(const uint8_t *src, uint16_t *dst)
{
    const uint16_t *s = (const uint16_t *)src;
    for (int y = 0; y < LCD_V_RES; y++) {
        int sy = y * ANIM_H / LCD_V_RES;
        if (sy >= ANIM_H) sy = ANIM_H - 1;
        uint16_t *drow = dst + y * LCD_H_RES;
        const uint16_t *srow = s + sy * ANIM_W;
        for (int x = 0; x < LCD_H_RES; x++) {
            int sx = x * ANIM_W / LCD_H_RES;
            if (sx >= ANIM_W) sx = ANIM_W - 1;
            drow[x] = srow[sx];
        }
    }
}

/* ========== 刷屏 (RGB565 字节序交换 + 4 行分块) ========== */
static void flush_framebuffer(void)
{
    uint16_t *buf = (uint16_t *)s_frame_buf;
    for (int y = 0; y < LCD_V_RES; y += 4) {
        int h = (y + 4 > LCD_V_RES) ? (LCD_V_RES - y) : 4;
        int pixels = LCD_H_RES * h;
        uint16_t *strip = buf + y * LCD_H_RES;
        for (int i = 0; i < pixels; i++) {
            uint16_t v = strip[i];
            strip[i] = (v >> 8) | (v << 8);
        }
        esp_lcd_panel_draw_bitmap(s_panel, 0, y, LCD_H_RES, y + h, strip);
    }
}

/* ========== 页面绘制: 连接页 ========== */
static void draw_connect(int spinner_step)
{
    uint16_t *buf = (uint16_t *)s_frame_buf;
    draw_background();

    /* 标题 "TraePal" (ASCII scale=1) */
    draw_text_center_sb(buf, "TraePal", 180, COL_TRAE_GRN, 1, 1);

    /* "连接中" (中文 scale=1) + "..." */
    int cn_w = text_width_sb("连接中", 1);
    int dot_w = text_width_sb("...", 1);
    int total_w = cn_w + dot_w;
    int start_x = (LCD_H_RES - total_w) / 2;
    draw_text_sb(buf, "连接中", start_x, 240, COL_WHITE, 1, 1);
    draw_text_sb(buf, "...", start_x + cn_w, 240, COL_WHITE, 1, 1);

    /* 旋转 spinner (圆弧) */
    int cx = CENTER_X, cy = 320, r = 24;
    for (int a = 0; a < 270; a++) {
        float rad = (a + spinner_step * 10) * M_PI / 180.0f;
        int x = cx + (int)(r * cosf(rad));
        int y = cy + (int)(r * sinf(rad));
        if (x >= 0 && x < LCD_H_RES && y >= 0 && y < LCD_V_RES)
            buf[y * LCD_H_RES + x] = COL_TRAE_GRN;
    }
    fill_circle(buf, cx, cy, 4, COL_DARK_GR);
}

/* ========== 页面绘制: 待机页 ========== */
static void draw_ready(void)
{
    uint16_t *buf = (uint16_t *)s_frame_buf;

    /* 播放 idle_ready 动画 (状态 0), 放大 240→466 */
    if (s_states_part && load_state_frame(0, s_ready_frame)) {
        scale_frame_240_to_466(s_anim_buf_240, buf);
    } else {
        draw_background();
    }
    s_ready_frame = (s_ready_frame + 1) % FRAMES_PER_STATE;

    /* 底部提示 "上滑进入菜单" (scale=1), 半透明背景条 */
    int hint_y = LCD_V_RES - 50;
    int hint_h = 32 + 8;
    for (int y = hint_y - 4; y < hint_y + hint_h; y++) {
        for (int x = 60; x < LCD_H_RES - 60; x++) {
            int dx = x - CENTER_X, dy = y - CENTER_Y;
            if (dx * dx + dy * dy > (SCREEN_RADIUS - 4) * (SCREEN_RADIUS - 4)) continue;
            if (x >= 0 && x < LCD_H_RES && y >= 0 && y < LCD_V_RES) {
                uint16_t v = buf[y * LCD_H_RES + x];
                uint8_t r = (v >> 11) & 0x1F, g = (v >> 5) & 0x3F, b = v & 0x1F;
                r = r / 2; g = g / 2; b = b / 2;
                buf[y * LCD_H_RES + x] = (r << 11) | (g << 5) | b;
            }
        }
    }
    draw_text_center_sb(buf, "上滑菜单 右滑额度", hint_y, COL_TRAE_GRN, 1, 1);
}

/* ========== 菜单图标绘制 ========== */
static void draw_menu_icon(uint16_t *buf, int cx, int cy, int idx, uint16_t color)
{
    int s = 16;
    switch (idx) {
        case 0: /* 状态 - 仪表盘 */
            for (int a = 180; a <= 360; a++) {
                float rad = a * M_PI / 180.0f;
                int x = cx + (int)(s * cosf(rad));
                int y = cy + (int)(s * sinf(rad));
                if (x >= 0 && x < LCD_H_RES && y >= 0 && y < LCD_V_RES)
                    buf[y * LCD_H_RES + x] = color;
            }
            draw_line(buf, cx, cy, cx + s * 2 / 3, cy - s / 2, color);
            fill_circle(buf, cx, cy, 2, color);
            break;
        case 1: /* 蜘蛛 - 圆+8腿 */
            fill_circle(buf, cx, cy, 6, color);
            for (int a = 0; a < 360; a += 45) {
                float rad = a * M_PI / 180.0f;
                int x1 = cx + (int)(8 * cosf(rad));
                int y1 = cy + (int)(8 * sinf(rad));
                int x2 = cx + (int)(s * cosf(rad));
                int y2 = cy + (int)(s * sinf(rad));
                draw_line(buf, x1, y1, x2, y2, color);
            }
            break;
        case 2: /* 告警 - 三角+! */
            for (int dy = -s; dy <= s; dy++) {
                int hw = s - abs(dy);
                if (abs(dy) > 2 && abs(dy) < s - 1) {
                    draw_hline(buf, cx - hw / 2, cx + hw / 2, cy + dy, color);
                }
            }
            draw_vline(buf, cx, cy - 4, cy + 2, COL_BLACK);
            fill_rect(buf, cx - 1, cy + 4, 2, 2, COL_BLACK);
            break;
        case 3: /* 能量 - 闪电 */
            draw_line(buf, cx - 2, cy - s, cx + 4, cy - 2, color);
            draw_line(buf, cx + 4, cy - 2, cx - 2, cy, color);
            draw_line(buf, cx - 2, cy, cx + 4, cy + 2, color);
            draw_line(buf, cx + 4, cy + 2, cx - 2, cy + s, color);
            break;
        case 4: /* 设置 - 齿轮 */
            fill_circle(buf, cx, cy, 7, color);
            fill_circle(buf, cx, cy, 3, COL_DARK_GR);
            for (int a = 0; a < 360; a += 45) {
                float rad = a * M_PI / 180.0f;
                int tx = cx + (int)(10 * cosf(rad));
                int ty = cy + (int)(10 * sinf(rad));
                fill_rect(buf, tx - 1, ty - 1, 3, 3, color);
            }
            break;
        case 5: /* 关于 - i 圆 */
            draw_circle(buf, cx, cy, s, color);
            draw_vline(buf, cx, cy - 2, cy + 6, color);
            fill_rect(buf, cx - 1, cy - 7, 2, 2, color);
            break;
        default:
            break;
    }
}

/* ========== 页面绘制: 菜单页 ========== */
/* 角度 → 菜单索引 (6 方向, 每 60°)
 * angle_deg: atan2(dy, dx) * 180/PI, 范围 [-180, 180]
 * 中心方向: 上=-90, 右上=-30, 右下=30, 下=90, 左下=150, 左上=-150 */
static int angle_to_menu_idx(float angle_deg)
{
    if (angle_deg >= -120 && angle_deg < -60) return 0;  /* 上 */
    if (angle_deg >= -60 && angle_deg < 0)    return 1;  /* 右上 */
    if (angle_deg >= 0 && angle_deg < 60)     return 2;  /* 右下 */
    if (angle_deg >= 60 && angle_deg < 120)   return 3;  /* 下 */
    if (angle_deg >= 120 && angle_deg <= 180) return 4;  /* 左下 */
    if (angle_deg >= -180 && angle_deg < -120) return 5; /* 左上 */
    return -1;
}

static void draw_menu(void)
{
    uint16_t *buf = (uint16_t *)s_frame_buf;
    draw_background();

    /* 拖拽中: 绘制指示线 (中心 → 高亮项) */
    if (s_drag_active && s_drag_idx >= 0) {
        int bx = s_menu_items[s_drag_idx].x;
        int by = s_menu_items[s_drag_idx].y;
        /* 沿径向方向, 从中心圆边缘到按钮边缘画线 */
        float ang = atan2f(by - CENTER_Y, bx - CENTER_X);
        int x1 = CENTER_X + cosf(ang) * DRAG_CENTER_RADIUS;
        int y1 = CENTER_Y + sinf(ang) * DRAG_CENTER_RADIUS;
        int x2 = bx - cosf(ang) * MENU_BTN_RADIUS;
        int y2 = by - sinf(ang) * MENU_BTN_RADIUS;
        draw_line(buf, x1, y1, x2, y2, COL_BRIGHT_GR);
    }

    /* 6 个径向菜单按钮 (高亮项向外弹出) */
    for (int i = 0; i < 6; i++) {
        int bx = s_menu_items[i].x;
        int by = s_menu_items[i].y;
        int br = MENU_BTN_RADIUS;

        /* 拖拽中高亮项沿径向方向外移 */
        int is_drag_highlight = (s_drag_active && i == s_drag_idx);
        if (is_drag_highlight) {
            float ang = atan2f(by - CENTER_Y, bx - CENTER_X);
            bx = bx + cosf(ang) * DRAG_POP_OFFSET;
            by = by + sinf(ang) * DRAG_POP_OFFSET;
        }

        uint16_t bg, border, icon_col, text_col;
        if (is_drag_highlight || i == s_menu_highlight) {
            bg = COL_DARK_GR; border = COL_BRIGHT_GR;
            icon_col = COL_BRIGHT_GR; text_col = COL_WHITE;
        } else {
            bg = COL_DIM_GRAY; border = COL_TRAE_GRN;
            icon_col = COL_TRAE_GRN; text_col = COL_WHITE;
        }
        fill_circle(buf, bx, by, br, bg);
        draw_circle(buf, bx, by, br, border);
        draw_circle(buf, bx, by, br - 1, COL_DEEP_BLK);

        /* 图标 (按钮上半部) */
        draw_menu_icon(buf, bx, by - 10, i, icon_col);

        /* 中文标签 (按钮下半部, scale=1) */
        const char *text = s_menu_items[i].cn_name;
        int tw = text_width_sb(text, 1);
        int tx = bx - tw / 2;
        int ty = by + 8;
        draw_text_sb(buf, text, tx, ty, text_col, 1, 1);
    }

    /* 中心圆: 拖拽中显示当前项名, 否则显示"菜单" */
    fill_circle(buf, CENTER_X, CENTER_Y, DRAG_CENTER_RADIUS, COL_DEEP_BLK);
    if (s_drag_active && s_drag_idx >= 0) {
        draw_circle(buf, CENTER_X, CENTER_Y, DRAG_CENTER_RADIUS, COL_BRIGHT_GR);
        /* 显示当前高亮项中文名 */
        const char *text = s_menu_items[s_drag_idx].cn_name;
        int tw = text_width_sb(text, 1);
        draw_text_sb(buf, text, CENTER_X - tw / 2, CENTER_Y - 16, COL_BRIGHT_GR, 1, 1);
    } else {
        draw_circle(buf, CENTER_X, CENTER_Y, DRAG_CENTER_RADIUS, COL_TRAE_GRN);
        draw_text_center_sb(buf, "菜单", CENTER_Y - 16, COL_TRAE_GRN, 1, 1);
    }
}

/* ========== 页面绘制: 状态页 ========== */
static void draw_status(void)
{
    uint16_t *buf = (uint16_t *)s_frame_buf;

    /* 循环播放当前状态 12 帧动画, 放大 240→466 */
    if (s_states_part && load_state_frame(s_state_index, s_status_frame)) {
        scale_frame_240_to_466(s_anim_buf_240, buf);
    } else {
        draw_background();
    }
    s_status_frame = (s_status_frame + 1) % FRAMES_PER_STATE;

    /* 顶部状态名 (半透明背景条 + 文字) */
    int name_y = 16;
    int name_h = 40;  /* scale=1 中文 32px 高 */
    for (int y = name_y - 4; y < name_y + name_h; y++) {
        for (int x = 30; x < LCD_H_RES - 30; x++) {
            int dx = x - CENTER_X, dy = y - CENTER_Y;
            if (dx * dx + dy * dy > (SCREEN_RADIUS - 4) * (SCREEN_RADIUS - 4)) continue;
            if (x >= 0 && x < LCD_H_RES && y >= 0 && y < LCD_V_RES) {
                uint16_t v = buf[y * LCD_H_RES + x];
                uint8_t r = (v >> 11) & 0x1F, g = (v >> 5) & 0x3F, b = v & 0x1F;
                r = r / 2; g = g / 2; b = b / 2;
                buf[y * LCD_H_RES + x] = (r << 11) | (g << 5) | b;
            }
        }
    }
    /* 中文名 (scale=1) */
    draw_text_center_sb(buf, state_cn_names[s_state_index], name_y, COL_TRAE_GRN, 1, 1);
    /* 英文名 (scale=1, 不加粗) */
    draw_text_center_sb(buf, state_names[s_state_index], name_y + 36, COL_GRAY, 1, 0);

    /* 底部提示 */
    int hint_y = LCD_V_RES - 40;
    draw_text_center_sb(buf, "滑动选择", hint_y, COL_DIM_GRAY, 1, 0);
}

/* ========== 页面绘制: 蜘蛛页 ========== */
static void draw_spider(void)
{
    uint16_t *buf = (uint16_t *)s_frame_buf;

    /* spider_bot 12 帧循环动画 (状态 7), 放大 240→466 */
    if (s_states_part && load_state_frame(7, s_spider_frame)) {
        scale_frame_240_to_466(s_anim_buf_240, buf);
    } else {
        draw_background();
    }
    s_spider_frame = (s_spider_frame + 1) % FRAMES_PER_STATE;

    /* 标题 "蜘蛛" (scale=1) */
    draw_text_center_sb(buf, "蜘蛛", 16, COL_TRAE_GRN, 1, 1);

    /* 底部提示 */
    draw_text_center_sb(buf, "上滑返回", LCD_V_RES - 30, COL_DIM_GRAY, 1, 0);
}

/* ========== 页面绘制: 告警页 (bug_alert ↔ fix_success 自动切换) ========== */
static void draw_alert(void)
{
    uint16_t *buf = (uint16_t *)s_frame_buf;

    /* 每 ~200ms 切一帧, 12 帧后切状态 (12×200ms = 2.4s) */
    uint32_t now = xTaskGetTickCount() * portTICK_PERIOD_MS;
    if (now - s_last_anim_tick >= 200) {
        s_last_anim_tick = now;
        s_alert_frame = (s_alert_frame + 1) % FRAMES_PER_STATE;
        if (s_alert_frame == 0) {
            s_alert_state = !s_alert_state;
        }
    }

    int state = s_alert_state ? 4 : 3;  /* fix_success=4, bug_alert=3 */
    if (s_states_part && load_state_frame(state, s_alert_frame)) {
        scale_frame_240_to_466(s_anim_buf_240, buf);
    } else {
        draw_background();
    }

    /* 标题 (scale=1) */
    const char *title = s_alert_state ? "修复" : "告警";
    uint16_t tcol = s_alert_state ? COL_TRAE_GRN : COL_RED;
    draw_text_center_sb(buf, title, 16, tcol, 1, 1);

    /* 底部提示 */
    draw_text_center_sb(buf, "上滑返回", LCD_V_RES - 30, COL_DIM_GRAY, 1, 0);
}

/* ========== 页面绘制: 能量页 (task_charge/thinking_scan/thinking_focus 轮播) ========== */
static void draw_energy(void)
{
    uint16_t *buf = (uint16_t *)s_frame_buf;

    /* 每 ~200ms 切一帧, 12 帧后切状态 (12×200ms = 2.4s) */
    uint32_t now = xTaskGetTickCount() * portTICK_PERIOD_MS;
    if (now - s_last_anim_tick >= 200) {
        s_last_anim_tick = now;
        s_energy_frame = (s_energy_frame + 1) % FRAMES_PER_STATE;
        if (s_energy_frame == 0) {
            s_energy_state = (s_energy_state + 1) % ENERGY_COUNT;
        }
    }

    int state = energy_states[s_energy_state];
    if (s_states_part && load_state_frame(state, s_energy_frame)) {
        scale_frame_240_to_466(s_anim_buf_240, buf);
    } else {
        draw_background();
    }

    /* 标题 (scale=1) */
    const char *titles[] = { "任务", "扫描", "聚焦" };
    draw_text_center_sb(buf, titles[s_energy_state], 16, COL_TRAE_GRN, 1, 1);

    /* 底部提示 */
    draw_text_center_sb(buf, "上滑返回", LCD_V_RES - 30, COL_DIM_GRAY, 1, 0);
}

/* ========== 页面绘制: 设置页 ========== */
static void draw_settings(void)
{
    uint16_t *buf = (uint16_t *)s_frame_buf;
    draw_background();

    /* 标题 "设置" (scale=1) */
    draw_text_center_sb(buf, "设置", 20, COL_TRAE_GRN, 1, 1);

    /* 设置项 (假数据, scale=1) */
    const char *labels[] = { "硬件", "屏幕", "亮度", "版本" };
    const char *values[] = { "ESP32-S3", "466x466", "60", "1.0" };
    int item_h = 50;
    int start_y = 100;
    for (int i = 0; i < 4; i++) {
        int y = start_y + i * item_h;
        /* 背景条 */
        for (int yy = y; yy < y + item_h - 8; yy++) {
            for (int xx = 50; xx < LCD_H_RES - 50; xx++) {
                int dx = xx - CENTER_X, dy = yy - CENTER_Y;
                if (dx * dx + dy * dy > (SCREEN_RADIUS - 6) * (SCREEN_RADIUS - 6)) continue;
                if (xx >= 0 && xx < LCD_H_RES && yy >= 0 && yy < LCD_V_RES)
                    buf[yy * LCD_H_RES + xx] = COL_DIM_GRAY;
            }
        }
        draw_rounded_rect(buf, 50, y, LCD_H_RES - 100, item_h - 8, 6, COL_DARK_GR);
        /* 标签 (scale=1) */
        draw_text_sb(buf, labels[i], 70, y + 8, COL_TRAE_GRN, 1, 1);
        /* 值 (scale=1) */
        int val_x = 70 + text_width_sb(labels[i], 1) + 12;
        draw_text_sb(buf, values[i], val_x, y + 8, COL_WHITE, 1, 0);
    }

    /* 底部提示 */
    draw_text_center_sb(buf, "上滑返回", LCD_V_RES - 30, COL_DIM_GRAY, 1, 0);
}

/* ========== 页面绘制: 关于页 ========== */
static void draw_about(void)
{
    uint16_t *buf = (uint16_t *)s_frame_buf;
    draw_background();

    /* 标题 "关于" (scale=1) */
    draw_text_center_sb(buf, "关于", 20, COL_TRAE_GRN, 1, 1);

    /* "TraePal" (ASCII scale=1, 修复只显示 tp 的问题) */
    draw_text_center_sb(buf, "TraePal", 130, COL_WHITE, 1, 1);

    /* 项目信息 (scale=1) */
    draw_text_center_sb(buf, "离线版本", 190, COL_TRAE_GRN, 1, 1);
    draw_text_center_sb(buf, "圆形屏界面", 240, COL_TRAE_GRN, 1, 1);
    draw_text_center_sb(buf, "演示应用", 290, COL_GRAY, 1, 1);

    /* 底部提示 */
    draw_text_center_sb(buf, "上滑返回", LCD_V_RES - 25, COL_DIM_GRAY, 1, 0);
}

/* ========== 日期时间更新 (软件时钟) ========== */
static void update_datetime(void)
{
    uint32_t now = xTaskGetTickCount() * portTICK_PERIOD_MS;
    if (s_dt_last_tick == 0) { s_dt_last_tick = now; return; }
    uint32_t elapsed_ms = now - s_dt_last_tick;
    int elapsed_sec = (int)(elapsed_ms / 1000);
    if (elapsed_sec <= 0) return;
    s_dt_last_tick += (uint32_t)elapsed_sec * 1000;

    s_dt.sec += elapsed_sec;
    while (s_dt.sec >= 60) { s_dt.sec -= 60; s_dt.min++; }
    while (s_dt.min >= 60) { s_dt.min -= 60; s_dt.hour++; }
    while (s_dt.hour >= 24) {
        s_dt.hour -= 24;
        s_dt.day++;
        s_dt.weekday = (s_dt.weekday + 1) % 7;
        /* 简化: 不处理月末, 演示够用 */
        if (s_dt.month == 2) { if (s_dt.day > 28) { s_dt.day = 1; s_dt.month++; } }
        else if (s_dt.month <= 7) { if (s_dt.day > 31) { s_dt.day = 1; s_dt.month++; } }
        else { if (s_dt.day > 31) { s_dt.day = 1; s_dt.month++; } }
        if (s_dt.month > 12) { s_dt.month = 1; s_dt.year++; }
    }
}

/* ========== 统一日期时间绘制 (底部居中, 不喧宾夺主) ========== */
/* 格式: "14:30  07/01 周三"  scale=1 */
static void draw_datetime(uint16_t *buf)
{
    char line[32];
    const char *wd_names[] = { "周日", "周一", "周二", "周三", "周四", "周五", "周六" };
    /* 时间 HH:MM  日期 MM/DD 星期 */
    snprintf(line, sizeof(line), "%02d:%02d  %02d/%02d %s",
             s_dt.hour, s_dt.min, s_dt.month, s_dt.day, wd_names[s_dt.weekday]);
    /* 底部半透明背景条 */
    int y = LCD_V_RES - 22;
    for (int yy = y - 3; yy < y + 18; yy++) {
        if (yy < 0 || yy >= LCD_V_RES) continue;
        for (int xx = 80; xx < LCD_H_RES - 80; xx++) {
            int dx = xx - CENTER_X, dy = yy - CENTER_Y;
            if (dx * dx + dy * dy > (SCREEN_RADIUS - 2) * (SCREEN_RADIUS - 2)) continue;
            uint16_t v = buf[yy * LCD_H_RES + xx];
            uint8_t r = (v >> 11) & 0x1F, g = (v >> 5) & 0x3F, b = v & 0x1F;
            r = r / 3; g = g / 3; b = b / 3;
            buf[yy * LCD_H_RES + xx] = (r << 11) | (g << 5) | b;
        }
    }
    int tw = text_width_sb(line, 1);
    draw_text_sb(buf, line, (LCD_H_RES - tw) / 2, y, COL_DIM_GRAY, 1, 0);
}

/* ========== 辅助: 填充圆角矩形 ========== */
static void fill_rounded_rect(uint16_t *buf, int x, int y, int w, int h, int r, uint16_t color)
{
    if (r < 0) r = 0;
    if (r > w / 2) r = w / 2;
    if (r > h / 2) r = h / 2;
    fill_rect(buf, x + r, y, w - 2 * r, h, color);
    fill_rect(buf, x, y + r, w, h - 2 * r, color);
    for (int dy = 0; dy < r; dy++) {
        for (int dx = 0; dx < r; dx++) {
            int dist2 = (r - 1 - dx) * (r - 1 - dx) + (r - 1 - dy) * (r - 1 - dy);
            if (dist2 < r * r) {
                int px, py;
                px = x + r - 1 - dx; py = y + r - 1 - dy;
                if (px >= 0 && px < LCD_H_RES && py >= 0 && py < LCD_V_RES) buf[py * LCD_H_RES + px] = color;
                px = x + w - r + dx; py = y + r - 1 - dy;
                if (px >= 0 && px < LCD_H_RES && py >= 0 && py < LCD_V_RES) buf[py * LCD_H_RES + px] = color;
                px = x + r - 1 - dx; py = y + h - r + dy;
                if (px >= 0 && px < LCD_H_RES && py >= 0 && py < LCD_V_RES) buf[py * LCD_H_RES + px] = color;
                px = x + w - r + dx; py = y + h - r + dy;
                if (px >= 0 && px < LCD_H_RES && py >= 0 && py < LCD_V_RES) buf[py * LCD_H_RES + px] = color;
            }
        }
    }
}

/* ========== 辅助: RGB565 颜色明暗 (f>0 变亮, f<0 变暗) ========== */
static uint16_t shade565(uint16_t color, float f)
{
    uint8_t r = (color >> 11) & 0x1F;
    uint8_t g = (color >> 5)  & 0x3F;
    uint8_t b =  color        & 0x1F;
    if (f >= 0) {
        r = (uint8_t)(r + (31 - r) * f);
        g = (uint8_t)(g + (63 - g) * f);
        b = (uint8_t)(b + (31 - b) * f);
    } else {
        r = (uint8_t)(r * (1 + f));
        g = (uint8_t)(g * (1 + f));
        b = (uint8_t)(b * (1 + f));
    }
    return (uint16_t)((r << 11) | (g << 5) | b);
}

/* ========== RGB565 颜色辅助 ========== */
static uint16_t color_mix_565(uint16_t c1, uint16_t c2, float t)
{
    int r1 = (c1 >> 11) & 0x1F, g1 = (c1 >> 5) & 0x3F, b1 = c1 & 0x1F;
    int r2 = (c2 >> 11) & 0x1F, g2 = (c2 >> 5) & 0x3F, b2 = c2 & 0x1F;
    int r = (int)(r1 + (r2 - r1) * t);
    int g = (int)(g1 + (g2 - g1) * t);
    int b = (int)(b1 + (b2 - b1) * t);
    return (uint16_t)((r << 11) | (g << 5) | b);
}

static uint16_t color_lighten_565(uint16_t c, float amount)
{
    return color_mix_565(c, 0xFFFF, amount);
}

static uint16_t color_darken_565(uint16_t c, float amount)
{
    int r = (c >> 11) & 0x1F, g = (c >> 5) & 0x3F, b = c & 0x1F;
    r = (int)(r * (1.0f - amount));
    g = (int)(g * (1.0f - amount));
    b = (int)(b * (1.0f - amount));
    return (uint16_t)((r << 11) | (g << 5) | b);
}

/* ========== 辅助: 单层弧带 [rLo, rHi] (fill_circle 逐角度打点, 消除径向接缝锯齿) ========== */
static void draw_arc_band(uint16_t *buf, int cx, int cy,
                          int rLo, int rHi, uint16_t color,
                          float startDeg, float sweepDeg)
{
    if (rHi <= rLo) return;
    int rMid = (rLo + rHi) / 2;
    int thick = (rHi - rLo + 1) / 2;
    if (thick < 1) thick = 1;
    /* 步进: 半径越大步进越小, 保证相邻圆重叠 */
    float step = (rMid > 200) ? 0.15f : 0.2f;
    for (float a = 0; a < sweepDeg; a += step) {
        float deg = startDeg + a;
        float rad = (deg - 90) * M_PI / 180.0f;
        int x = cx + (int)(rMid * cosf(rad));
        int y = cy + (int)(rMid * sinf(rad));
        fill_circle(buf, x, y, thick, color);
    }
}

/* ========== 辅助: 终点圆帽 (光晕+白心+主色, 精致小尺寸) ========== */
static void draw_arc_cap(uint16_t *buf, int cx, int cy,
                         int rMid, float deg, uint16_t color)
{
    float rad = (deg - 90) * M_PI / 180.0f;
    int hx = cx + (int)(rMid * cosf(rad));
    int hy = cy + (int)(rMid * sinf(rad));
    fill_circle(buf, hx, hy, 6, color_lighten_565(color, 0.5f));   /* 外层光晕 */
    fill_circle(buf, hx, hy, 4, COL_WHITE);                        /* 白心 */
    fill_circle(buf, hx, hy, 2, color);                             /* 主色芯 */
}

/* ========== 弧形进度环 (三层圆帽版) ==========
 * design angle: 0=顶部, 顺时针. 画 rIn~rOut 环带.
 * 三层: 外亮边 + 中主色 + 内暗边. 轨道同结构.
 * 终点圆帽: 光晕 r=7 + 白心 r=5 + 主色芯 r=3. */
static void draw_arc_range(uint16_t *buf, int cx, int cy,
                           int rIn, int rOut,
                           uint16_t fill_color, uint16_t track_color,
                           int pct, float startDeg, float sweepDeg)
{
    if (sweepDeg <= 0) return;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    /* 厚度保护: 至少 6px 才能分三层 */
    if (rOut - rIn < 6) return;
    float fillDeg = sweepDeg * pct / 100.0f;

    /* 三层半径划分 */
    int rOuterLo = rOut - 2, rOuterHi = rOut;
    int rMidLo   = rIn + 2,  rMidHi   = rOut - 2;
    int rInnerLo = rIn,      rInnerHi = rIn + 2;

    uint16_t cOuter = color_lighten_565(fill_color, 0.15f);
    uint16_t cMid   = color_darken_565(fill_color, 0.08f);
    uint16_t cInner = color_darken_565(fill_color, 0.35f);
    uint16_t tOuter = color_darken_565(track_color, 0.25f);
    uint16_t tInner = color_darken_565(track_color, 0.35f);

    /* 1. 完整轨道 (三层) */
    draw_arc_band(buf, cx, cy, rOuterLo, rOuterHi, tOuter, startDeg, sweepDeg);
    draw_arc_band(buf, cx, cy, rMidLo,   rMidHi,   track_color, startDeg, sweepDeg);
    draw_arc_band(buf, cx, cy, rInnerLo, rInnerHi, tInner, startDeg, sweepDeg);

    /* 2. 进度前景 (三层, 亮度收敛) */
    if (pct > 0) {
        draw_arc_band(buf, cx, cy, rOuterLo, rOuterHi, cOuter, startDeg, fillDeg);
        draw_arc_band(buf, cx, cy, rMidLo,   rMidHi,   cMid, startDeg, fillDeg);
        draw_arc_band(buf, cx, cy, rInnerLo, rInnerHi, cInner, startDeg, fillDeg);

        /* 3. 终点圆帽 */
        int rMid = (rIn + rOut) / 2;
        float tipDeg = startDeg + fillDeg;
        draw_arc_cap(buf, cx, cy, rMid, tipDeg, fill_color);
    }
}

/* ========== 辅助: 3D 球体背景 (三层同心圆, 左上光照) ========== */
static void draw_avatar_orb(uint16_t *buf, int cx, int cy, int R, uint16_t color)
{
    fill_circle(buf, cx, cy, R, shade565(color, -0.82f));
    fill_circle(buf, cx - R / 5, cy - R / 5, (int)(R * 0.72f), shade565(color, -0.66f));
    fill_circle(buf, cx - (int)(R * 0.33f), cy - (int)(R * 0.33f), (int)(R * 0.42f), shade565(color, -0.50f));
}

/* ========== 辅助: 10 段进度条 meter (Codey drawMeter 风格) ==========
 * y: 垂直中心. label 左, 10段居中, pct 右, right_str 最右 */
static void draw_meter(uint16_t *buf, int y, const char *label,
                       int used, const char *right_str, uint16_t color)
{
    const int segs = 10;
    const int pitch = 13;
    const int segW = 10;
    const int segH = 8;
    int filled = used * segs / 100;
    if (filled > segs) filled = segs;
    bool hot = used >= 85;
    uint16_t segc = hot ? COL_RED : color;
    uint16_t empty = 0x1082;

    /* label 居左 */
    draw_text_sb(buf, label, 98, y - 8, COL_WHITE, 1, 0);

    /* 10 段圆角矩形 (barX 固定 164) */
    int barX = 164;
    for (int i = 0; i < segs; i++) {
        int sx = barX + i * pitch;
        fill_rounded_rect(buf, sx, y - 5, segW, segH, 2, i < filled ? segc : empty);
    }

    /* pct 右侧 (白色粗体) */
    char pc[8];
    snprintf(pc, sizeof(pc), "%d%%", used);
    draw_text_sb(buf, pc, 304, y - 8, COL_WHITE, 1, 1);

    /* right_str 最右 (灰色) */
    draw_text_sb(buf, right_str, 350, y - 8, COL_DIM_GRAY, 1, 0);
}

/* ========== 页面绘制: 会员额度页 (Codey 仪表盘风格 + TRAE 黑绿配色) ==========
 * 基于 Codey renderUsagePage 布局:
 *   边缘 AA 弧(已用%) + header(圆点+套餐名+时钟) + 3D球体头像
 *   + 套餐小字 + 双 meter(已用/剩余) + 可用次数 + 升级信息 + 日期时间
 * 颜色: TRAE 黑绿 (COL_TRAE_GRN 主色, 纯黑背景)
 * 文字: 中文会员额度信息 (速通 Pro+ / 132次 / 升级Ultra 593.04元 等) */
static void draw_quota(void)
{
    uint16_t *buf = (uint16_t *)s_frame_buf;
    /* 纯黑背景 */
    fill_rect(buf, 0, 0, LCD_H_RES, LCD_V_RES, COL_BLACK);

    /* ---- 边缘弧: 三层圆帽版, rIn=194 rOut=214, start=-132° sweep=264° ---- */
    draw_arc_range(buf, CENTER_X, CENTER_Y, 194, 214,
                   COL_TRAE_GRN, 0x1082, QUOTA_USED_PCT, -132.0f, 264.0f);

    /* ---- header: PRO+ 会员 (居中, scale=1, bold, TRAE 绿) ---- */
    {
        const char *name = "PRO+ 会员";
        int nameW = text_width_sb(name, 1);
        draw_text_sb(buf, name, CENTER_X - nameW / 2, 34, COL_TRAE_GRN, 1, 1);
    }

    /* ---- 3D 球体 + thinking_focus 头像 (中心 233,150) ---- */
    {
        int orbR = 63;
        int orbCx = CENTER_X, orbCy = 150;
        draw_avatar_orb(buf, orbCx, orbCy, orbR, COL_TRAE_GRN);
        /* 圆形裁剪绘制头像动图, 100×100 居中于 (233,150) */
        int anim_size = 100;
        int anim_x = 183;   /* 233 - 50 */
        int anim_y = 100;   /* 150 - 50 */
        if (s_states_part && load_state_frame(2, s_quota_frame)) {
            const uint16_t *s = (const uint16_t *)s_anim_buf_240;
            int clip_r = anim_size / 2;
            for (int y = 0; y < anim_size; y++) {
                int sy = y * ANIM_H / anim_size;
                if (sy >= ANIM_H) sy = ANIM_H - 1;
                const uint16_t *srow = s + sy * ANIM_W;
                for (int x = 0; x < anim_size; x++) {
                    int sx = x * ANIM_W / anim_size;
                    if (sx >= ANIM_W) sx = ANIM_W - 1;
                    int dx = x - anim_size / 2;
                    int dy = y - anim_size / 2;
                    if (dx * dx + dy * dy > clip_r * clip_r) continue;
                    int px = anim_x + x, py = anim_y + y;
                    if (px >= 0 && px < LCD_H_RES && py >= 0 && py < LCD_V_RES)
                        buf[py * LCD_H_RES + px] = srow[sx];
                }
            }
        }
        s_quota_frame = (s_quota_frame + 1) % FRAMES_PER_STATE;
    }

    /* ---- 套餐信息: 拆两行避免截断 ---- */
    draw_text_center_sb(buf, "速通 Pro+", 214, COL_GRAY, 1, 0);
    draw_text_center_sb(buf, "单月",      230, COL_DIM_GRAY, 1, 0);

    /* ---- 双 meter: 已用(y=260→label252/bar255) / 剩余(y=290→label282/bar285) ---- */
    draw_meter(buf, 260, "已用", QUOTA_USED_PCT,   "168", COL_TRAE_GRN);
    draw_meter(buf, 290, "剩余", QUOTA_REMAIN_PCT, "132", COL_BRIGHT_GR);

    /* ---- 中心主信息: 三行垂直 (可用/132/次) ---- */
    {
        char num[8];
        snprintf(num, sizeof(num), "%d", QUOTA_REMAIN);
        int numW = text_width_sb(num, 2);
        int lblW1 = text_width_sb("可用", 1);
        int lblW2 = text_width_sb("次", 1);
        draw_text_sb(buf, "可用", CENTER_X - lblW1 / 2, 316, COL_GRAY, 1, 0);
        draw_text_sb(buf, num,    CENTER_X - numW / 2,   334, COL_BRIGHT_GR, 2, 1);
        draw_text_sb(buf, "次",   CENTER_X - lblW2 / 2, 364, COL_GRAY, 1, 0);
    }

    /* ---- 升级信息 (单条主+单条次, 精简) ---- */
    {
        char line1[32];
        snprintf(line1, sizeof(line1), "Ultra %s", UPGRADE_PAY);
        draw_text_center_sb(buf, line1, 392, COL_CYAN, 1, 1);

        char line2[48];
        snprintf(line2, sizeof(line2), "抵扣%s 到期07/21", UPGRADE_DEDUCT);
        draw_text_center_sb(buf, line2, 412, COL_DIM_GRAY, 1, 0);
    }

    /* ---- 日期时间 (轻量, 无底条) ---- */
    {
        const char *wd_names[] = {"周日","周一","周二","周三","周四","周五","周六"};
        char line[32];
        snprintf(line, sizeof(line), "%02d:%02d %02d/%02d %s",
                 s_dt.hour, s_dt.min, s_dt.month, s_dt.day, wd_names[s_dt.weekday]);
        int tw = text_width_sb(line, 1);
        draw_text_sb(buf, line, (LCD_H_RES - tw) / 2, 438, COL_DIM_GRAY, 1, 0);
    }
}

/* ========== UI 任务 ========== */
static void ui_task(void *arg)
{
    int spinner_step = 0;
    while (1) {
        update_datetime();
        xSemaphoreTake(s_state_mutex, portMAX_DELAY);
        page_t page = s_current_page;
        xSemaphoreGive(s_state_mutex);

        switch (page) {
            case PAGE_CONNECT:
                draw_connect(spinner_step);
                spinner_step++;
                flush_framebuffer();
                /* 1.5s 后自动进入待机 */
                if ((xTaskGetTickCount() - s_connect_start_tick) * portTICK_PERIOD_MS > 1500) {
                    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                    s_current_page = PAGE_READY;
                    s_ready_frame = 0;
                    xSemaphoreGive(s_state_mutex);
                    ESP_LOGI(TAG, "连接完成 → 待机页");
                }
                vTaskDelay(pdMS_TO_TICKS(50));
                break;

            case PAGE_READY:
                draw_ready();
                draw_datetime((uint16_t *)s_frame_buf);
                flush_framebuffer();
                vTaskDelay(pdMS_TO_TICKS(30));  /* 33fps */
                break;

            case PAGE_MENU:
                draw_menu();
                draw_datetime((uint16_t *)s_frame_buf);
                flush_framebuffer();
                vTaskDelay(pdMS_TO_TICKS(80));
                break;

            case PAGE_STATUS:
                draw_status();
                draw_datetime((uint16_t *)s_frame_buf);
                flush_framebuffer();
                vTaskDelay(pdMS_TO_TICKS(30));  /* 动画 33fps */
                break;

            case PAGE_SPIDER:
                draw_spider();
                draw_datetime((uint16_t *)s_frame_buf);
                flush_framebuffer();
                vTaskDelay(pdMS_TO_TICKS(20));  /* 50fps 加速 */
                break;

            case PAGE_ALERT:
                draw_alert();
                draw_datetime((uint16_t *)s_frame_buf);
                flush_framebuffer();
                vTaskDelay(pdMS_TO_TICKS(80));
                break;

            case PAGE_ENERGY:
                draw_energy();
                draw_datetime((uint16_t *)s_frame_buf);
                flush_framebuffer();
                vTaskDelay(pdMS_TO_TICKS(80));
                break;

            case PAGE_SETTINGS:
                draw_settings();
                draw_datetime((uint16_t *)s_frame_buf);
                flush_framebuffer();
                vTaskDelay(pdMS_TO_TICKS(80));
                break;

            case PAGE_ABOUT:
                draw_about();
                draw_datetime((uint16_t *)s_frame_buf);
                flush_framebuffer();
                vTaskDelay(pdMS_TO_TICKS(80));
                break;

            case PAGE_QUOTA:
                draw_quota();
                flush_framebuffer();
                vTaskDelay(pdMS_TO_TICKS(80));
                break;

            default:
                vTaskDelay(pdMS_TO_TICKS(100));
                break;
        }
    }
}

/* ========== 触摸任务 ========== */
static int hit_test_menu(int tx, int ty)
{
    for (int i = 0; i < 6; i++) {
        int dx = tx - s_menu_items[i].x;
        int dy = ty - s_menu_items[i].y;
        if (dx * dx + dy * dy < MENU_BTN_RADIUS * MENU_BTN_RADIUS) return i;
    }
    return -1;
}

static void touch_task(void *arg)
{
    esp_lcd_touch_point_data_t touch_data[5];
    uint8_t touch_cnt = 0;
    bool touching = false;
    bool long_pressed = false;
    int start_x = 0, start_y = 0, last_x = 0, last_y = 0;
    uint32_t touch_start_tick = 0;

    while (1) {
        vTaskDelay(pdMS_TO_TICKS(10));  /* 100Hz 采样 */

        xSemaphoreTake(s_state_mutex, portMAX_DELAY);
        page_t page = s_current_page;
        xSemaphoreGive(s_state_mutex);

        if (!s_touch) continue;

        esp_lcd_touch_read_data(s_touch);
        esp_err_t r = esp_lcd_touch_get_data(s_touch, touch_data, &touch_cnt, 5);
        bool pressed = (r == ESP_OK && touch_cnt > 0);

        if (pressed) {
            int tx = touch_data[0].x;
            int ty = touch_data[0].y;
            if (!touching) {
                touching = true;
                long_pressed = false;
                start_x = last_x = tx;
                start_y = last_y = ty;
                touch_start_tick = xTaskGetTickCount();
            } else {
                last_x = tx;
                last_y = ty;
            }

            /* 长按检测 (>800ms) → 回待机页 */
            uint32_t duration = (xTaskGetTickCount() - touch_start_tick) * portTICK_PERIOD_MS;
            if (duration > 800 && !long_pressed) {
                long_pressed = true;
                xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                if (s_current_page != PAGE_READY && s_current_page != PAGE_CONNECT) {
                    s_current_page = PAGE_READY;
                    s_ready_frame = 0;
                    ESP_LOGI(TAG, "长按 → 待机页");
                }
                xSemaphoreGive(s_state_mutex);
            }

            /* 菜单页: 中心圆内开始拖拽, 拖拽中计算角度选方向 */
            if (page == PAGE_MENU && !long_pressed) {
                if (!s_drag_active) {
                    /* 判断是否在中心圆内按下 */
                    int cdx = tx - CENTER_X, cdy = ty - CENTER_Y;
                    if (cdx * cdx + cdy * cdy < DRAG_CENTER_RADIUS * DRAG_CENTER_RADIUS) {
                        xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                        s_drag_active = 1;
                        s_drag_idx = -1;
                        s_drag_start_x = tx;
                        s_drag_start_y = ty;
                        s_menu_highlight = -1;
                        xSemaphoreGive(s_state_mutex);
                    } else {
                        /* 中心圆外: 兼容点击按钮高亮 */
                        int hit = hit_test_menu(tx, ty);
                        xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                        s_menu_highlight = hit;
                        xSemaphoreGive(s_state_mutex);
                    }
                } else {
                    /* 拖拽中: 计算角度选方向 */
                    int ddx = tx - CENTER_X, ddy = ty - CENTER_Y;
                    int dist2 = ddx * ddx + ddy * ddy;
                    int new_idx = -1;
                    if (dist2 > DRAG_DEAD_ZONE * DRAG_DEAD_ZONE) {
                        float ang = atan2f((float)ddy, (float)ddx) * 180.0f / M_PI;
                        new_idx = angle_to_menu_idx(ang);
                    }
                    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                    s_drag_idx = new_idx;
                    xSemaphoreGive(s_state_mutex);
                }
            }
        } else if (touching) {
            /* 释放 */
            touching = false;
            int dx = last_x - start_x;
            int dy = last_y - start_y;
            uint32_t duration = (xTaskGetTickCount() - touch_start_tick) * portTICK_PERIOD_MS;
            int dist2 = dx * dx + dy * dy;

            /* 菜单页拖拽释放: 选中当前高亮方向 */
            if (page == PAGE_MENU && s_drag_active) {
                xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                int drag_select = s_drag_idx;
                s_drag_active = 0;
                s_drag_idx = -1;
                s_menu_highlight = -1;
                xSemaphoreGive(s_state_mutex);
                if (drag_select >= 0) {
                    /* 进入拖拽选中的页面 */
                    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                    s_current_page = s_menu_items[drag_select].target_page;
                    if (s_current_page == PAGE_STATUS) {
                        s_state_index = 0;
                        s_status_frame = 0;
                    } else if (s_current_page == PAGE_SPIDER) {
                        s_spider_frame = 0;
                    } else if (s_current_page == PAGE_ALERT) {
                        s_alert_frame = 0;
                        s_alert_state = 0;
                        s_last_anim_tick = xTaskGetTickCount() * portTICK_PERIOD_MS;
                    } else if (s_current_page == PAGE_ENERGY) {
                        s_energy_frame = 0;
                        s_energy_state = 0;
                        s_last_anim_tick = xTaskGetTickCount() * portTICK_PERIOD_MS;
                    }
                    xSemaphoreGive(s_state_mutex);
                    ESP_LOGI(TAG, "径向拖拽 → 页面 %d (%s)", drag_select, s_menu_items[drag_select].cn_name);
                }
                continue;  /* 拖拽释放后跳过其他手势判断 */
            }

            xSemaphoreTake(s_state_mutex, portMAX_DELAY);
            s_menu_highlight = -1;
            xSemaphoreGive(s_state_mutex);

            /* 长按已触发则跳过其他手势 */
            if (long_pressed) {
                continue;
            }

            /* 点击 (小位移 + 短时间) → 菜单页点击按钮 (兼容非拖拽点击) */
            if (dist2 < 400 && duration < 500) {
                if (page == PAGE_MENU) {
                    int hit = hit_test_menu(last_x, last_y);
                    if (hit >= 0) {
                        xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                        s_current_page = s_menu_items[hit].target_page;
                        /* 重置子页面动画帧 */
                        if (s_current_page == PAGE_STATUS) {
                            s_state_index = 0;
                            s_status_frame = 0;
                        } else if (s_current_page == PAGE_SPIDER) {
                            s_spider_frame = 0;
                        } else if (s_current_page == PAGE_ALERT) {
                            s_alert_frame = 0;
                            s_alert_state = 0;
                            s_last_anim_tick = xTaskGetTickCount() * portTICK_PERIOD_MS;
                        } else if (s_current_page == PAGE_ENERGY) {
                            s_energy_frame = 0;
                            s_energy_state = 0;
                            s_last_anim_tick = xTaskGetTickCount() * portTICK_PERIOD_MS;
                        }
                        xSemaphoreGive(s_state_mutex);
                        ESP_LOGI(TAG, "菜单点击 → 页面 %d", s_menu_items[hit].target_page);
                    }
                }
            }
            /* 上滑 (dy < -80): 子页面→Menu, Menu→Ready, Ready→Menu, Quota→Ready */
            else if (dy < -80 && abs(dy) > abs(dx)) {
                xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                if (page == PAGE_READY) {
                    s_current_page = PAGE_MENU;
                    ESP_LOGI(TAG, "上滑 → 菜单");
                } else if (page == PAGE_MENU) {
                    s_current_page = PAGE_READY;
                    s_ready_frame = 0;
                    ESP_LOGI(TAG, "上滑 → 待机");
                } else if (page == PAGE_QUOTA) {
                    /* 会员额度页 → 直接回 Ready (不是回 Menu) */
                    s_current_page = PAGE_READY;
                    s_ready_frame = 0;
                    ESP_LOGI(TAG, "上滑 → 待机 (从会员额度)");
                } else {
                    /* 子页面 → 菜单 */
                    s_current_page = PAGE_MENU;
                    ESP_LOGI(TAG, "上滑 → 菜单 (从子页面返回)");
                }
                xSemaphoreGive(s_state_mutex);
            }
            /* 左滑 (dx < -60): 状态页下一个状态 */
            else if (dx < -60 && abs(dx) > abs(dy)) {
                if (page == PAGE_STATUS) {
                    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                    s_state_index = (s_state_index + 1) % STATE_COUNT;
                    s_status_frame = 0;
                    xSemaphoreGive(s_state_mutex);
                    ESP_LOGI(TAG, "左滑 → 下一个状态 %d (%s)", s_state_index, state_names[s_state_index]);
                }
            }
            /* 右滑 (dx > 60): Ready→会员额度页, 状态页上一个状态 */
            else if (dx > 60 && abs(dx) > abs(dy)) {
                if (page == PAGE_READY) {
                    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                    s_current_page = PAGE_QUOTA;
                    s_quota_frame = 0;
                    xSemaphoreGive(s_state_mutex);
                    ESP_LOGI(TAG, "右滑 → 会员额度页");
                } else if (page == PAGE_STATUS) {
                    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                    s_state_index = (s_state_index - 1 + STATE_COUNT) % STATE_COUNT;
                    s_status_frame = 0;
                    xSemaphoreGive(s_state_mutex);
                    ESP_LOGI(TAG, "右滑 → 上一个状态 %d (%s)", s_state_index, state_names[s_state_index]);
                }
            }
        }
    }
}

/* ========== 主函数 ========== */
void app_main(void)
{
    ESP_LOGI(TAG, "========== TraePal Demo Round UI (离线演示版 重写) ==========");

    /* NVS 初始化 */
    esp_err_t nvs_ret = nvs_flash_init();
    if (nvs_ret == ESP_ERR_NVS_NO_FREE_PAGES || nvs_ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ESP_ERROR_CHECK(nvs_flash_init());
    }

    /* 显示初始化 */
    bsp_display_config_t disp_cfg = { .max_transfer_sz = FRAME_BYTES };
    ESP_ERROR_CHECK(bsp_display_new(&disp_cfg, &s_panel, NULL));
    bsp_display_brightness_set(60);
    ESP_LOGI(TAG, "屏幕初始化成功 (466x466 AMOLED)");

    /* PSRAM 帧缓冲 + 动画缓冲 */
    s_frame_buf = heap_caps_malloc(FRAME_BYTES, MALLOC_CAP_SPIRAM);
    s_anim_buf_240 = heap_caps_malloc(ANIM_FRAME_BYTES, MALLOC_CAP_SPIRAM);
    if (!s_frame_buf || !s_anim_buf_240) {
        ESP_LOGE(TAG, "PSRAM 分配失败 (frame=%p anim=%p)",
                 s_frame_buf, s_anim_buf_240);
        return;
    }
    memset(s_frame_buf, 0, FRAME_BYTES);
    memset(s_anim_buf_240, 0, ANIM_FRAME_BYTES);
    ESP_LOGI(TAG, "PSRAM 缓冲分配成功 (frame=%u anim=%u)",
             (unsigned)FRAME_BYTES, (unsigned)ANIM_FRAME_BYTES);

    /* 分区初始化 */
    partitions_init();

    /* 触摸初始化 */
    bsp_display_cfg_t cfg = {
        .rotation = BSP_DISPLAY_ROTATE_0,
        .touch_flags = { .swap_xy = 0, .mirror_x = 1, .mirror_y = 1 },
    };
    esp_err_t ret = bsp_touch_new(&cfg, &s_touch);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "触摸初始化失败: %s", esp_err_to_name(ret));
    } else {
        ESP_LOGI(TAG, "触摸初始化成功 (mirror_x=1, mirror_y=1)");
    }

    /* 互斥锁 + 任务 */
    s_state_mutex = xSemaphoreCreateMutex();
    s_connect_start_tick = xTaskGetTickCount();
    s_last_anim_tick = xTaskGetTickCount() * portTICK_PERIOD_MS;

    xTaskCreate(ui_task, "ui", 8192, NULL, 3, NULL);
    xTaskCreate(touch_task, "touch", 4096, NULL, 5, NULL);

    ESP_LOGI(TAG, "系统启动完成 (连接页 → 1.5s 后进待机页)");
}
