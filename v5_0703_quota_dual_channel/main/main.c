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
    "左",                                                                       /* 210 */
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
    PAGE_WATCH,      /* 手表面 (Ready 左滑进入) */
    PAGE_PROJECT,    /* 项目子菜单 (主菜单"项目"进入, 六宫格) */
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
static datetime_t s_dt = { 2026, 7, 2, 23, 58, 0, 4 };  /* 2026/07/02 周四 23:58 (真实当前时间) */
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
static uint32_t s_quota_enter_tick = 0;  /* 进入额度页 tick (弧填充动画) */

/* ====== 额度页布局参数 (字号用 px, xy 位置, 单独定义便于调整) ======
 * px 指中文字符视觉高度: 32px=scale1, 64px=scale2, 96px=scale3
 * ASCII 字宽 = 8 × scale, 中文字宽 = 32 × scale
 * SC_FROM_PX() 在调用处把 px 转成 scale (字体点阵只支持整数倍放大) */
#define QUOTA_ARC_ANIM_MS      500    /* 边缘弧动画时长: 20帧 × 25ms (40fps) */
#define QUOTA_ARC_FRAMES       20     /* 动画总帧数 */
#define SC_FROM_PX(px)         ((px) >= 80 ? 3 : ((px) >= 48 ? 2 : 1))  /* px→scale */

#define Q_HEADER_Y             52     /* TRAE Work header (下移到 52) */
#define Q_HEADER_PX            48     /* header 字号 (px) — 缩小到 80% (原 64) */
#define Q_HEADER_BOLD          1

#define Q_AVATAR_SIZE          150    /* 头像动图尺寸 */
#define Q_AVATAR_CX            233
#define Q_AVATAR_CY            150
#define Q_ORB_R                75     /* 3D 球体半径 (配合 150 头像) */

#define Q_PLAN_Y               226    /* 套餐小字 */

#define Q_METER1_Y             280    /* 已用 meter 中心 (下移 30) */
#define Q_METER2_Y             316    /* 剩余 meter 中心 (下移 30) */
#define Q_METER_LABEL_X        86     /* 已用/剩余 label X (回退无右移) */
#define Q_METER_BAR_X          165
#define Q_METER_PCT_X          310
#define Q_METER_RIGHT_X        362
#define Q_METER_VAL_PX         32     /* pct/右值 字号 (px) */

#define Q_MAIN_Y               345    /* 可用 132 次 (向上平移避让底部时钟) */
#define Q_MAIN_PX              96     /* 主信息字号 (px) — scale3 增大 */

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
    { 103, 163, "项目", PAGE_PROJECT  },  /* 左上 (关于→项目, 进入六宫格子菜单) */
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

/* ========== 双通道混合渲染 (中文背景 + 英数前景) ==========
 * 中文: 32×32 字库 2:1 降采样到 16×16, 作低分辨率背景层 (cn_color 暗色)
 * ASCII/数字: 8×16 字体 × ascii_scale 放大, 作高分辨率前景 (ascii_color 亮色)
 * 中文垂直居中对齐 ASCII 高度
 */
static int text_width_bgfg(const char *text, int ascii_scale)
{
    int w = 0;
    while (*text) {
        uint8_t c = (uint8_t)*text;
        if (c < 0x80) { w += 8 * ascii_scale; text++; }
        else if ((c & 0xF0) == 0xE0) { w += 16; text += 3; }
        else if ((c & 0xE0) == 0xC0) { w += 8 * ascii_scale; text += 2; }
        else text++;
    }
    return w;
}

static int draw_text_bgfg(uint16_t *buf, const char *text, int x, int y,
                          uint16_t cn_color, uint16_t ascii_color,
                          int ascii_scale, int bold)
{
    int ascii_h = 16 * ascii_scale;
    int cn_y_off = (ascii_h - 16) / 2;  /* 中文垂直居中 */

    /* 第一遍: 画中文 (16×16 降采样, 暗色背景层) */
    int cx = x;
    const char *t = text;
    while (*t) {
        uint8_t c = (uint8_t)*t;
        if (c < 0x80) {
            cx += 8 * ascii_scale;
            t++;
        } else if ((c & 0xF0) == 0xE0) {
            int idx = find_chinese_index(t);
            if (idx >= 0 && s_font_part) {
                uint8_t mask[1024];
                if (esp_partition_read(s_font_part, (uint32_t)idx * 1024, mask, 1024) == ESP_OK) {
                    for (int row = 0; row < 16; row++) {
                        for (int col = 0; col < 16; col++) {
                            uint8_t a0 = mask[(row*2)   * 32 + (col*2)];
                            uint8_t a1 = mask[(row*2)   * 32 + (col*2+1)];
                            uint8_t a2 = mask[(row*2+1) * 32 + (col*2)];
                            uint8_t a3 = mask[(row*2+1) * 32 + (col*2+1)];
                            uint8_t amax = a0 > a1 ? a0 : a1;
                            amax = amax > a2 ? amax : a2;
                            amax = amax > a3 ? amax : a3;
                            if (amax > 80) {
                                int px = cx + col;
                                int py = y + cn_y_off + row;
                                if (px >= 0 && px < LCD_H_RES && py >= 0 && py < LCD_V_RES)
                                    buf[py * LCD_H_RES + px] = cn_color;
                            }
                        }
                    }
                }
                cx += 16;
            } else {
                cx += 8 * ascii_scale;
            }
            t += 3;
        } else if ((c & 0xE0) == 0xC0) { t += 2; }
        else { t++; }
    }

    /* 第二遍: 画 ASCII (8×16 × scale, 亮色前景层) */
    cx = x;
    t = text;
    while (*t) {
        uint8_t c = (uint8_t)*t;
        if (c < 0x80) {
            if (c < 32 || c > 127) c = '?';
            const uint8_t *glyph = font8x16[c - 32];
            for (int row = 0; row < 16; row++) {
                for (int col = 0; col < 8; col++) {
                    if (glyph[row] & (0x80 >> col)) {
                        for (int sy = 0; sy < ascii_scale; sy++) {
                            for (int sx = 0; sx < ascii_scale; sx++) {
                                int px = cx + col * ascii_scale + sx;
                                int py = y + row * ascii_scale + sy;
                                if (px >= 0 && px < LCD_H_RES && py >= 0 && py < LCD_V_RES)
                                    buf[py * LCD_H_RES + px] = ascii_color;
                                if (bold) {
                                    if (px + 1 < LCD_H_RES && py >= 0 && py < LCD_V_RES)
                                        buf[py * LCD_H_RES + px + 1] = ascii_color;
                                    if (px >= 0 && px < LCD_H_RES && py + 1 < LCD_V_RES)
                                        buf[(py + 1) * LCD_H_RES + px] = ascii_color;
                                }
                            }
                        }
                    }
                }
            }
            cx += 8 * ascii_scale;
            t++;
        } else if ((c & 0xF0) == 0xE0) {
            cx += 16;
            t += 3;
        } else if ((c & 0xE0) == 0xC0) { t += 2; }
        else { t++; }
    }
    return cx - x;
}

static void draw_text_bgfg_center(uint16_t *buf, const char *text, int y,
                                   uint16_t cn_color, uint16_t ascii_color,
                                   int ascii_scale, int bold)
{
    int w = text_width_bgfg(text, ascii_scale);
    int x = (LCD_H_RES - w) / 2;
    draw_text_bgfg(buf, text, x, y, cn_color, ascii_color, ascii_scale, bold);
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

/* 圆角矩形填充 (从六宫格版本接入) */
static void fill_round_rect(uint16_t *buf, int x, int y, int w, int h, int r, uint16_t color)
{
    fill_rect(buf, x + r, y, w - 2 * r, h, color);
    fill_rect(buf, x, y + r, w, h - 2 * r, color);
    for (int dy = 0; dy < r; dy++) {
        for (int dx = 0; dx < r; dx++) {
            int dist2 = (r - 1 - dx) * (r - 1 - dx) + (r - 1 - dy) * (r - 1 - dy);
            if (dist2 <= (r - 1) * (r - 1)) {
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

    /* 底部提示 "上滑菜单 进入额度" (中文16px缩小一半, 上移, 半透明背景条) */
    int hint_y = LCD_V_RES - 70;
    int hint_h = 16 + 8;
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
    draw_text_bgfg_center(buf, "上滑菜单 左滑额度", hint_y, COL_TRAE_GRN, COL_TRAE_GRN, 1, 1);
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

/* ========== 菜单视觉辅助: 科技感径向摇杆 ========== */
static uint16_t menu_mix_565(uint16_t c1, uint16_t c2, float t)
{
    int r1 = (c1 >> 11) & 0x1F, g1 = (c1 >> 5) & 0x3F, b1 = c1 & 0x1F;
    int r2 = (c2 >> 11) & 0x1F, g2 = (c2 >> 5) & 0x3F, b2 = c2 & 0x1F;
    int r = (int)(r1 + (r2 - r1) * t);
    int g = (int)(g1 + (g2 - g1) * t);
    int b = (int)(b1 + (b2 - b1) * t);
    return (uint16_t)((r << 11) | (g << 5) | b);
}

static void menu_put_pixel(uint16_t *buf, int x, int y, uint16_t color)
{
    if (x >= 0 && x < LCD_H_RES && y >= 0 && y < LCD_V_RES)
        buf[y * LCD_H_RES + x] = color;
}

static uint16_t menu_accent_color(int idx)
{
    switch (idx) {
        case 0: return COL_YELLOW;    /* 状态 */
        case 1: return COL_TRAE_GRN;  /* 蜘蛛 */
        case 2: return COL_RED;       /* 告警 */
        case 3: return COL_CYAN;      /* 能量 */
        case 4: return COL_TRAE_GRN;  /* 设置 */
        case 5: return COL_CYAN;      /* 关于 */
        default: return COL_TRAE_GRN;
    }
}

static void draw_menu_thick_line(uint16_t *buf, int x1, int y1, int x2, int y2,
                                 int radius, uint16_t color)
{
    int dx = abs(x2 - x1), dy = abs(y2 - y1);
    int sx = (x1 < x2) ? 1 : -1;
    int sy = (y1 < y2) ? 1 : -1;
    int err = dx - dy;
    int x = x1, y = y1;
    while (1) {
        fill_circle(buf, x, y, radius, color);
        if (x == x2 && y == y2) break;
        int e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx)  { err += dx; y += sy; }
    }
}

static void draw_menu_arc(uint16_t *buf, int radius, float center_deg,
                          float sweep_deg, int dot_r, uint16_t color)
{
    float start = center_deg - sweep_deg * 0.5f;
    float end = center_deg + sweep_deg * 0.5f;
    for (float deg = start; deg <= end; deg += 1.8f) {
        float rad = deg * M_PI / 180.0f;
        int x = CENTER_X + (int)(radius * cosf(rad));
        int y = CENTER_Y + (int)(radius * sinf(rad));
        fill_circle(buf, x, y, dot_r, color);
    }
}

static void draw_menu_arc_range(uint16_t *buf, int radius, float start_deg,
                                float end_deg, int dot_r, uint16_t color)
{
    for (float deg = start_deg; deg <= end_deg; deg += 1.2f) {
        float rad = deg * M_PI / 180.0f;
        int x = CENTER_X + (int)(radius * cosf(rad));
        int y = CENTER_Y + (int)(radius * sinf(rad));
        fill_circle(buf, x, y, dot_r, color);
    }
}

static void draw_menu_ring_segment(uint16_t *buf, float center_deg, float sweep_deg,
                                   int inner_r, int outer_r,
                                   uint16_t fill, uint16_t stroke)
{
    float start = center_deg - sweep_deg * 0.5f;
    float end = center_deg + sweep_deg * 0.5f;
    for (float deg = start; deg <= end; deg += 0.25f) {
        float rad = deg * M_PI / 180.0f;
        float c = cosf(rad), s = sinf(rad);
        for (int r = inner_r; r <= outer_r; r++) {
            menu_put_pixel(buf,
                           CENTER_X + (int)(r * c),
                           CENTER_Y + (int)(r * s),
                           fill);
        }
    }

    draw_menu_arc_range(buf, outer_r, start, end, 1, stroke);
    draw_menu_arc_range(buf, inner_r, start, end, 1, menu_mix_565(stroke, COL_BLACK, 0.62f));
    float sr = start * M_PI / 180.0f;
    float er = end * M_PI / 180.0f;
    draw_menu_thick_line(buf,
                         CENTER_X + (int)(inner_r * cosf(sr)),
                         CENTER_Y + (int)(inner_r * sinf(sr)),
                         CENTER_X + (int)(outer_r * cosf(sr)),
                         CENTER_Y + (int)(outer_r * sinf(sr)),
                         1, menu_mix_565(stroke, COL_BLACK, 0.55f));
    draw_menu_thick_line(buf,
                         CENTER_X + (int)(inner_r * cosf(er)),
                         CENTER_Y + (int)(inner_r * sinf(er)),
                         CENTER_X + (int)(outer_r * cosf(er)),
                         CENTER_Y + (int)(outer_r * sinf(er)),
                         1, menu_mix_565(stroke, COL_BLACK, 0.55f));
}

static void draw_menu_reticle(uint16_t *buf, int cx, int cy, int r, uint16_t color)
{
    draw_circle(buf, cx, cy, r, color);
    draw_circle(buf, cx, cy, r - 10, menu_mix_565(color, COL_BLACK, 0.55f));
    draw_line(buf, cx - r - 8, cy, cx - r + 8, cy, color);
    draw_line(buf, cx + r - 8, cy, cx + r + 8, cy, color);
    draw_line(buf, cx, cy - r - 8, cx, cy - r + 8, color);
    draw_line(buf, cx, cy + r - 8, cx, cy + r + 8, color);
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

    /* HTML 原型 menu 形态: 环形扇面 + 顶/底两段粗外弧 */
    draw_menu_arc_range(buf, 212, 208, 332, 2, menu_mix_565(COL_CYAN, COL_BLACK, 0.48f));
    draw_menu_arc_range(buf, 212, -56, 58, 2, menu_mix_565(COL_TRAE_GRN, COL_BLACK, 0.42f));
    draw_circle(buf, CENTER_X, CENTER_Y, 116, menu_mix_565(COL_TRAE_GRN, COL_BLACK, 0.70f));
    draw_circle(buf, CENTER_X, CENTER_Y, 207, menu_mix_565(COL_TRAE_GRN, COL_BLACK, 0.58f));

    /* 6 个环形扇区按钮 */
    for (int i = 0; i < 6; i++) {
        int bx = s_menu_items[i].x;
        int by = s_menu_items[i].y;
        int is_active = (s_drag_active && i == s_drag_idx) || (i == s_menu_highlight);
        float ang = atan2f(by - CENTER_Y, bx - CENTER_X);
        float deg = ang * 180.0f / M_PI;
        float sweep = (i == 0) ? 52.0f : 46.0f;
        int inner_r = is_active ? 136 : 140;
        int outer_r = is_active ? 198 : 193;
        uint16_t accent = menu_accent_color(i);
        uint16_t edge = is_active ? accent : menu_mix_565(accent, COL_BLACK, 0.42f);
        uint16_t fill = is_active
            ? menu_mix_565(COL_DEEP_BLK, accent, 0.23f)
            : menu_mix_565(COL_DEEP_BLK, accent, 0.07f);
        uint16_t stroke = is_active
            ? menu_mix_565(edge, COL_WHITE, 0.16f)
            : menu_mix_565(edge, COL_BLACK, 0.56f);

        draw_menu_ring_segment(buf, deg, sweep, inner_r, outer_r, fill, stroke);
        draw_menu_arc(buf, outer_r - 2, deg, sweep - 8.0f, is_active ? 4 : 2, menu_mix_565(edge, COL_BLACK, is_active ? 0.04f : 0.34f));
        draw_menu_arc(buf, outer_r - 2, deg, sweep - 8.0f, is_active ? 2 : 1, is_active ? edge : menu_mix_565(edge, COL_BLACK, 0.18f));
        draw_menu_arc_range(buf, outer_r - 10, deg - sweep * 0.5f + 7.0f,
                            deg - sweep * 0.5f + 16.0f, 1, edge);

        int icon_x = CENTER_X + (int)(154 * cosf(ang));
        int icon_y = CENTER_Y + (int)(154 * sinf(ang));
        draw_menu_icon(buf, icon_x, icon_y, i, is_active ? COL_WHITE : menu_mix_565(COL_WHITE, edge, 0.45f));

        /* 中文标签贴合圆形屏幕边缘: r=183→200, 中文白色 COL_WHITE */
        int label_x = CENTER_X + (int)(200 * cosf(ang));
        int label_y = CENTER_Y + (int)(200 * sinf(ang));
        const char *text = s_menu_items[i].cn_name;
        int tw = text_width_bgfg(text, 1);
        draw_text_bgfg(buf, text, label_x - tw / 2, label_y - 8,
                       COL_WHITE, is_active ? COL_WHITE : menu_mix_565(COL_WHITE, edge, 0.36f),
                       1, is_active);
    }

    /* 中心控制核, 对应原型中间 90px 圆盘 */
    fill_circle(buf, CENTER_X, CENTER_Y, 90, menu_mix_565(COL_DEEP_BLK, COL_TRAE_GRN, 0.08f));
    draw_circle(buf, CENTER_X, CENTER_Y, 90, menu_mix_565(COL_TRAE_GRN, COL_WHITE, 0.16f));
    draw_circle(buf, CENTER_X, CENTER_Y, 73, menu_mix_565(COL_CYAN, COL_BLACK, 0.48f));
    draw_menu_reticle(buf, CENTER_X, CENTER_Y, 50, s_drag_active ? COL_BRIGHT_GR : COL_TRAE_GRN);
    fill_circle(buf, CENTER_X, CENTER_Y, 34, COL_DEEP_BLK);
    draw_circle(buf, CENTER_X, CENTER_Y, 34, menu_mix_565(COL_TRAE_GRN, COL_WHITE, 0.12f));

    if (s_drag_active && s_drag_idx >= 0) {
        const char *text = s_menu_items[s_drag_idx].cn_name;
        int tw = text_width_bgfg(text, 1);
        draw_text_bgfg(buf, text, CENTER_X - tw / 2, CENTER_Y - 8, COL_GRAY, COL_BRIGHT_GR, 1, 1);
    } else {
        int tw = text_width_sb("TRAE", 1);
        draw_text_sb(buf, "TRAE", CENTER_X - tw / 2, CENTER_Y - 18, COL_TRAE_GRN, 1, 1);
        draw_text_sb(buf, "MENU", CENTER_X - text_width_sb("MENU", 1) / 2, CENTER_Y + 12, COL_GRAY, 1, 0);
    }
}

/* ========== 项目子菜单 (2×3 网格 + 6 个列表子菜单, 从六宫格版本接入) ========== */
/* 图标类型 */
typedef enum {
    ICON_PILL = 0, ICON_MOL, ICON_HELIX, ICON_GAUGE, ICON_PLAY, ICON_DATA,
    ICON_TRAIN, ICON_SUBMIT, ICON_BACK, ICON_COUNT
} icon_type_t;

/* 网格布局参数 */
#define GRID_COLS    3
#define GRID_ROWS    2
#define GRID_CELL_W  120
#define GRID_CELL_H  140
#define GRID_X_START ((LCD_H_RES - GRID_COLS * GRID_CELL_W) / 2)
#define GRID_Y_START 70

/* 列表布局参数 (子菜单用) */
#define LIST_ITEM_H   56
#define LIST_ITEM_GAP 8
#define LIST_ITEM_W   340
#define LIST_X_START  ((LCD_H_RES - LIST_ITEM_W) / 2)
#define LIST_Y_START  70

/* 子菜单 ID */
#define SUB_MAIN     0
#define SUB_DRUGCLIP 1
#define SUB_MOL      2
#define SUB_CONF     3
#define SUB_STATUS   4
#define SUB_ACTION   5
#define SUB_ABOUT    6
#define SUB_COUNT    7

/* 菜单数据结构 (从六宫格版本接入) */
typedef struct {
    const char *title;
    const char *items[6];
    int item_count;
    int parent;
    icon_type_t icons[6];
    int is_grid;
} submenu_t;

static const submenu_t s_submenus[SUB_COUNT] = {
    /* 0: 主菜单 - 2x3 网格 (6 项) */
    {
        .title = "项目",
        .items = {"筛选", "设计", "构象", "状态", "操作", "关于"},
        .item_count = 6, .parent = -1, .is_grid = 1,
        .icons = {ICON_PILL, ICON_MOL, ICON_HELIX, ICON_GAUGE, ICON_PLAY, ICON_DATA},
    },
    /* 1: 筛选 DrugCLIP */
    {
        .title = "DrugCLIP 筛选",
        .items = {"数据准备", "模型训练", "结果提交", "返回主菜单"},
        .item_count = 4, .parent = SUB_MAIN, .is_grid = 0,
        .icons = {ICON_DATA, ICON_TRAIN, ICON_SUBMIT, ICON_BACK},
    },
    /* 2: 设计 分子设计 */
    {
        .title = "分子设计",
        .items = {"对接运行", "参数优化", "结果提交", "返回主菜单"},
        .item_count = 4, .parent = SUB_MAIN, .is_grid = 0,
        .icons = {ICON_MOL, ICON_TRAIN, ICON_SUBMIT, ICON_BACK},
    },
    /* 3: 构象 蛋白构象 */
    {
        .title = "蛋白构象",
        .items = {"精度评估", "多样性采样", "结果提交", "返回主菜单"},
        .item_count = 4, .parent = SUB_MAIN, .is_grid = 0,
        .icons = {ICON_HELIX, ICON_MOL, ICON_SUBMIT, ICON_BACK},
    },
    /* 4: 状态 项目状态 */
    {
        .title = "项目状态",
        .items = {"当前状态", "运行状态", "告警状态", "成功状态", "返回主菜单"},
        .item_count = 5, .parent = SUB_MAIN, .is_grid = 0,
        .icons = {ICON_GAUGE, ICON_PLAY, ICON_PILL, ICON_SUBMIT, ICON_BACK},
    },
    /* 5: 操作 选择操作 */
    {
        .title = "选择操作",
        .items = {"运行下一步", "重跑当前", "提交结果", "返回主菜单"},
        .item_count = 4, .parent = SUB_MAIN, .is_grid = 0,
        .icons = {ICON_PLAY, ICON_TRAIN, ICON_SUBMIT, ICON_BACK},
    },
    /* 6: 关于 */
    {
        .title = "关于",
        .items = {"项目版本", "离线系统", "测试演示", "返回主菜单"},
        .item_count = 4, .parent = SUB_MAIN, .is_grid = 0,
        .icons = {ICON_DATA, ICON_GAUGE, ICON_PLAY, ICON_BACK},
    },
};

/* 当前子菜单索引 (0=主网格, 1-6=列表子菜单) */
static int s_current_submenu = SUB_MAIN;

/* 项目子菜单网格: 6 项, 文字 + 图标 (从 s_submenus[0] 取) */
static const struct {
    const char *name;
    icon_type_t icon;
    int target_submenu;  /* 点击后进入的子菜单索引 */
} s_project_items[6] = {
    { "筛选", ICON_PILL,  SUB_DRUGCLIP },
    { "设计", ICON_MOL,   SUB_MOL      },
    { "构象", ICON_HELIX, SUB_CONF     },
    { "状态", ICON_GAUGE, SUB_STATUS   },
    { "操作", ICON_PLAY,  SUB_ACTION   },
    { "关于", ICON_DATA,  SUB_ABOUT    },
};

/* 简易图标绘制 (从六宫格版本精简接入) */
static void draw_icon(uint16_t *buf, int cx, int cy, int size, icon_type_t icon, uint16_t color)
{
    int s = size / 2;
    switch (icon) {
        case ICON_PILL: {
            int w = size, h = size / 3;
            for (int y = -h/2; y < h/2; y++) {
                for (int x = -w/2; x < w/2; x++) {
                    int dx = (x < -w/2 + h/2) ? (x + w/2 - h/2) : ((x > w/2 - h/2) ? (x - w/2 + h/2) : 0);
                    int dy = y;
                    if (dx * dx + dy * dy <= (h/2) * (h/2)) {
                        int px = cx + x, py = cy + y;
                        if (px >= 0 && px < LCD_H_RES && py >= 0 && py < LCD_V_RES)
                            buf[py * LCD_H_RES + px] = (x < 0) ? color : COL_WHITE;
                    }
                }
            }
            break;
        }
        case ICON_MOL: {
            int r = size / 6;
            fill_circle(buf, cx - s/2, cy - s/3, r, color);
            fill_circle(buf, cx + s/2, cy - s/3, r, COL_WHITE);
            fill_circle(buf, cx, cy + s/2, r, COL_BRIGHT_GR);
            draw_hline(buf, cx - s/2 + r, cx + s/2 - r, cy - s/3, color);
            draw_vline(buf, cx, cy - s/3 + r, cy + s/2 - r, color);
            break;
        }
        case ICON_HELIX: {
            for (int t = -s; t <= s; t++) {
                int y = cy + t;
                int x1 = cx + (int)(s * 0.4 * sinf(t * 0.3f));
                int x2 = cx - (int)(s * 0.4 * sinf(t * 0.3f));
                if (y >= 0 && y < LCD_V_RES) {
                    if (x1 >= 0 && x1 < LCD_H_RES) buf[y * LCD_H_RES + x1] = color;
                    if (x2 >= 0 && x2 < LCD_H_RES) buf[y * LCD_H_RES + x2] = COL_WHITE;
                }
                if (t % 8 == 0) draw_hline(buf, x1, x2, y, COL_DARK_GR);
            }
            break;
        }
        case ICON_GAUGE: {
            int r = s;
            for (int a = 180; a <= 360; a++) {
                float rad = a * M_PI / 180.0f;
                int x = cx + (int)(r * cosf(rad));
                int y = cy + (int)(r * sinf(rad));
                if (x >= 0 && x < LCD_H_RES && y >= 0 && y < LCD_V_RES)
                    buf[y * LCD_H_RES + x] = color;
            }
            int px = cx + (int)(r * 0.8 * cosf(300 * M_PI / 180.0f));
            int py = cy + (int)(r * 0.8 * sinf(300 * M_PI / 180.0f));
            draw_vline(buf, cx, cy, py, color);
            draw_hline(buf, cx, px, py, color);
            fill_circle(buf, cx, cy, 3, COL_WHITE);
            break;
        }
        case ICON_PLAY: {
            for (int dy = -s; dy <= s; dy++) {
                int half_w = s - abs(dy);
                if (half_w <= 0) continue;
                for (int dx = 0; dx < half_w; dx++) {
                    int px = cx + dx, py = cy + dy;
                    if (px >= 0 && px < LCD_H_RES && py >= 0 && py < LCD_V_RES)
                        buf[py * LCD_H_RES + px] = color;
                }
            }
            break;
        }
        case ICON_DATA: {
            int bw = size / 5;
            int bh1 = size * 2 / 3, bh2 = size / 2, bh3 = size * 4 / 5;
            fill_rect(buf, cx - s + bw/2, cy + s/2 - bh1, bw, bh1, color);
            fill_rect(buf, cx - bw/2, cy + s/2 - bh2, bw, bh2, COL_WHITE);
            fill_rect(buf, cx + s - bw - bw/2, cy + s/2 - bh3, bw, bh3, COL_BRIGHT_GR);
            draw_hline(buf, cx - s, cx + s, cy + s/2, color);
            break;
        }
        case ICON_TRAIN: {
            /* 列车/箭头循环: 三个递进箭头 */
            for (int k = 0; k < 3; k++) {
                int y0 = cy - s + k * (2 * s / 3);
                int y1 = y0 + s / 3;
                for (int y = y0; y < y1; y++) {
                    int hw = (y - y0) + 2;
                    if (hw > s) hw = s;
                    for (int x = cx - hw; x < cx + hw; x++) {
                        if (x >= 0 && x < LCD_H_RES && y >= 0 && y < LCD_V_RES)
                            buf[y * LCD_H_RES + x] = (k == 1) ? COL_WHITE : color;
                    }
                }
            }
            break;
        }
        case ICON_SUBMIT: {
            /* 上传箭头: 三角向上 + 矩形底 */
            for (int y = cy - s; y < cy; y++) {
                int hw = (cy - y);
                if (hw > s) hw = s;
                for (int x = cx - hw; x < cx + hw; x++) {
                    if (x >= 0 && x < LCD_H_RES && y >= 0 && y < LCD_V_RES)
                        buf[y * LCD_H_RES + x] = color;
                }
            }
            fill_rect(buf, cx - s/4, cy, s/2, s, color);
            break;
        }
        case ICON_BACK: {
            /* 返回箭头 ← */
            draw_hline(buf, cx - s, cx + s, cy, color);
            for (int t = 0; t < s; t++) {
                int x = cx - s + t;
                draw_vline(buf, x, cy - t, cy, color);
                draw_vline(buf, x, cy, cy + t, color);
            }
            break;
        }
        case ICON_COUNT:
            break;
    }
}

/* 2×3 网格命中测试 */
static int hit_test_grid(int tx, int ty)
{
    for (int i = 0; i < 6; i++) {
        int col = i % GRID_COLS;
        int row = i / GRID_COLS;
        int cx = GRID_X_START + col * GRID_CELL_W + GRID_CELL_W / 2;
        int cy = GRID_Y_START + row * GRID_CELL_H + GRID_CELL_H / 2;
        if (tx >= cx - 50 && tx < cx + 50 && ty >= cy - 60 && ty < cy + 60) return i;
    }
    return -1;
}

/* 列表命中测试 (子菜单用) */
static int hit_test_list(int tx, int ty)
{
    const submenu_t *m = &s_submenus[s_current_submenu];
    for (int i = 0; i < m->item_count; i++) {
        int iy = LIST_Y_START + i * (LIST_ITEM_H + LIST_ITEM_GAP);
        if (tx >= LIST_X_START && tx < LIST_X_START + LIST_ITEM_W &&
            ty >= iy && ty < iy + LIST_ITEM_H) return i;
    }
    return -1;
}

/* 顶栏返回按钮命中 (x=24, y=34, r=16) */
static int hit_test_top_back(int tx, int ty)
{
    int cy = 34;
    int dx = tx - 24, dy = ty - cy;
    return (dx * dx + dy * dy < 256);
}

static void draw_project_menu(void)
{
    uint16_t *buf = (uint16_t *)s_frame_buf;
    draw_background();
    const submenu_t *m = &s_submenus[s_current_submenu];

    /* 顶栏: 标题 + 返回按钮(子菜单时显示) */
    if (m->parent >= 0) {
        /* 返回按钮 */
        fill_circle(buf, 24, 34, 16, COL_DARK_GR);
        draw_circle(buf, 24, 34, 16, COL_TRAE_GRN);
        draw_hline(buf, 16, 30, 34, COL_WHITE);
        for (int t = 0; t < 7; t++) {
            int x = 16 + t;
            draw_vline(buf, x, 34 - t, 34, COL_WHITE);
            draw_vline(buf, x, 34, 34 + t, COL_WHITE);
        }
    }
    /* 标题 */
    int tw = text_width_sb(m->title, 1);
    draw_text_sb(buf, m->title, CENTER_X - tw / 2, 18, COL_TRAE_GRN, 1, 1);

    if (m->is_grid) {
        /* 主网格布局 */
        for (int i = 0; i < m->item_count; i++) {
            int col = i % GRID_COLS;
            int row = i / GRID_COLS;
            int cx = GRID_X_START + col * GRID_CELL_W + GRID_CELL_W / 2;
            int cy = GRID_Y_START + row * GRID_CELL_H + GRID_CELL_H / 2;
            int bw = 100, bh = 120;

            int is_active = (i == s_menu_highlight);
            uint16_t bg, border, icon_col, text_col;
            if (is_active) {
                bg = COL_DARK_GR; border = COL_BRIGHT_GR; icon_col = COL_BRIGHT_GR; text_col = COL_WHITE;
            } else {
                bg = COL_DIM_GRAY; border = COL_TRAE_GRN; icon_col = COL_TRAE_GRN; text_col = COL_WHITE;
            }
            fill_round_rect(buf, cx - bw/2, cy - bh/2, bw, bh, 12, bg);
            draw_rounded_rect(buf, cx - bw/2, cy - bh/2, bw, bh, 12, border);
            draw_rounded_rect(buf, cx - bw/2 + 2, cy - bh/2 + 2, bw - 4, bh - 4, 10, border);

            draw_icon(buf, cx, cy - 24, 44, m->icons[i], icon_col);

            const char *text = m->items[i];
            int tw2 = text_width_sb(text, 1);
            draw_text_sb(buf, text, cx - tw2 / 2, cy + 22, text_col, 1, 1);
        }
    } else {
        /* 列表布局 (子菜单) */
        for (int i = 0; i < m->item_count; i++) {
            int iy = LIST_Y_START + i * (LIST_ITEM_H + LIST_ITEM_GAP);

            int is_active = (i == s_menu_highlight);
            uint16_t bg, border, icon_col, text_col;
            if (is_active) {
                bg = COL_DARK_GR; border = COL_BRIGHT_GR; icon_col = COL_BRIGHT_GR; text_col = COL_WHITE;
            } else {
                bg = COL_DIM_GRAY; border = COL_DARK_GR; icon_col = COL_TRAE_GRN; text_col = COL_WHITE;
            }
            fill_round_rect(buf, LIST_X_START, iy, LIST_ITEM_W, LIST_ITEM_H, 10, bg);
            draw_rounded_rect(buf, LIST_X_START, iy, LIST_ITEM_W, LIST_ITEM_H, 10, border);

            draw_icon(buf, LIST_X_START + 28, iy + LIST_ITEM_H / 2, 32, m->icons[i], icon_col);

            const char *text = m->items[i];
            int tw2 = text_width_sb(text, 1);
            draw_text_sb(buf, text, LIST_X_START + 56, iy + (LIST_ITEM_H - 16) / 2, text_col, 1, 1);
        }
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
/* 格式: "14:30  07/01"  scale=1 bold, 灰白色, 居中 (删除周X) */
static void draw_datetime(uint16_t *buf)
{
    char line[32];
    /* 时间 HH:MM  日期 MM/DD (无星期) */
    snprintf(line, sizeof(line), "%02d:%02d  %02d/%02d",
             s_dt.hour, s_dt.min, s_dt.month, s_dt.day);
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
    draw_text_sb(buf, line, (LCD_H_RES - tw) / 2, y, COL_GRAY, 1, 1);
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
/* HSV(h:0-360, s:0-1, v:0-1) → RGB565 */
static uint16_t hsv_to_rgb565(float h, float s, float v)
{
    float c = v * s;
    float hp = h / 60.0f;
    float x = c * (1.0f - fabsf(fmodf(hp, 2.0f) - 1.0f));
    float r1, g1, b1;
    if (hp < 1)      { r1 = c; g1 = x; b1 = 0; }
    else if (hp < 2) { r1 = x; g1 = c; b1 = 0; }
    else if (hp < 3) { r1 = 0; g1 = c; b1 = x; }
    else if (hp < 4) { r1 = 0; g1 = x; b1 = c; }
    else if (hp < 5) { r1 = x; g1 = 0; b1 = c; }
    else             { r1 = c; g1 = 0; b1 = x; }
    float m = v - c;
    int r5 = (int)((r1 + m) * 31.0f + 0.5f);
    int g6 = (int)((g1 + m) * 63.0f + 0.5f);
    int b5 = (int)((b1 + m) * 31.0f + 0.5f);
    if (r5 < 0) r5 = 0;
    if (r5 > 31) r5 = 31;
    if (g6 < 0) g6 = 0;
    if (g6 > 63) g6 = 63;
    if (b5 < 0) b5 = 0;
    if (b5 > 31) b5 = 31;
    return (uint16_t)((r5 << 11) | (g6 << 5) | b5);
}

/* 动图圆形边缘彩虹渐变环 (角度→色相, 随帧旋转) */
static void draw_rainbow_ring(uint16_t *buf, int cx, int cy, int r_in, int r_out, float rot_offset)
{
    for (int y = cy - r_out; y <= cy + r_out; y++) {
        if (y < 0 || y >= LCD_V_RES) continue;
        for (int x = cx - r_out; x <= cx + r_out; x++) {
            if (x < 0 || x >= LCD_H_RES) continue;
            int dx = x - cx, dy = y - cy;
            int d2 = dx * dx + dy * dy;
            if (d2 < r_in * r_in || d2 > r_out * r_out) continue;
            float ang = atan2f((float)dy, (float)dx) * 180.0f / (float)M_PI;
            if (ang < 0) ang += 360.0f;
            ang = fmodf(ang + rot_offset + 360.0f, 360.0f);
            buf[y * LCD_H_RES + x] = hsv_to_rgb565(ang, 1.0f, 1.0f);
        }
    }
}

static void draw_avatar_orb(uint16_t *buf, int cx, int cy, int R, uint16_t color)
{
    fill_circle(buf, cx, cy, R, shade565(color, -0.82f));
    fill_circle(buf, cx - R / 5, cy - R / 5, (int)(R * 0.72f), shade565(color, -0.66f));
    fill_circle(buf, cx - (int)(R * 0.33f), cy - (int)(R * 0.33f), (int)(R * 0.42f), shade565(color, -0.50f));
}

/* ========== 辅助: 10 段进度条 meter (Codey drawMeter 风格) ==========
 * y: 垂直中心. label 左, 10段居中, pct 右, right_str 最右 */
static void draw_meter(uint16_t *buf, int y, const char *label,
                       int used, const char *right_str, uint16_t color, int val_px)
{
    const int segs = 10;
    const int pitch = 14;
    const int segW = 11;
    const int segH = 10;
    int filled = used * segs / 100;
    if (filled > segs) filled = segs;
    bool hot = used >= 85;
    uint16_t segc = hot ? COL_RED : color;
    uint16_t empty = 0x1082;
    int val_sc = SC_FROM_PX(val_px);

    /* label 居左 (双通道: 中文16px白色 + 无ASCII) */
    draw_text_bgfg(buf, label, Q_METER_LABEL_X, y - 8, COL_WHITE, COL_WHITE, 1, 0);

    /* 10 段圆角矩形 (barX 居中) */
    int barX = Q_METER_BAR_X;
    for (int i = 0; i < segs; i++) {
        int sx = barX + i * pitch;
        fill_rounded_rect(buf, sx, y - 5, segW, segH, 2, i < filled ? segc : empty);
    }

    /* pct 右侧 (纯ASCII, 白色粗体) */
    char pc[8];
    snprintf(pc, sizeof(pc), "%d%%", used);
    draw_text_sb(buf, pc, Q_METER_PCT_X, y - 8, COL_WHITE, val_sc, 1);

    /* right_str 最右 (双通道: 数字亮 + 中文白色) */
    draw_text_bgfg(buf, right_str, Q_METER_RIGHT_X, y - 8, COL_WHITE, COL_WHITE, val_sc, 0);
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

    /* ---- 边缘弧填充动画: 20帧 ease-out cubic, 0→目标进度 ---- */
    uint32_t elapsed = (xTaskGetTickCount() - s_quota_enter_tick) * portTICK_PERIOD_MS;
    int arc_pct;
    if (elapsed >= QUOTA_ARC_ANIM_MS) {
        arc_pct = QUOTA_USED_PCT;
    } else {
        float t = (float)elapsed / (float)QUOTA_ARC_ANIM_MS;
        /* ease-in-out cubic: 开始慢(减速起步)+中段快+末尾慢(减速结束), 平滑过渡 */
        float e = (t < 0.5f)
                  ? (4.0f * t * t * t)
                  : (1.0f - powf(-2.0f * t + 2.0f, 3.0f) / 2.0f);
        arc_pct = (int)(QUOTA_USED_PCT * e + 0.5f);
    }

    /* ---- 边缘弧: 三层圆帽版, rIn=194 rOut=214, start=-132° sweep=264° ---- */
    draw_arc_range(buf, CENTER_X, CENTER_Y, 194, 214,
                   COL_TRAE_GRN, 0x1082, arc_pct, -132.0f, 264.0f);

    /* ---- header: TRAE WORK (居中, y=Q_HEADER_Y, px→scale, bold, 绿色渐变) ---- */
    {
        const char *name = "TRAE WORK";
        int sc = SC_FROM_PX(Q_HEADER_PX);
        int nameW = text_width_sb(name, sc);
        int sx = CENTER_X - nameW / 2;
        int n = (int)strlen(name);
        for (int i = 0; i < n; i++) {
            char c2[2] = { name[i], 0 };
            float t = (n > 1) ? (float)i / (float)(n - 1) : 0.0f;
            uint16_t col = color_mix_565(COL_TRAE_GRN, COL_BRIGHT_GR, t);
            draw_text_sb(buf, c2, sx, Q_HEADER_Y, col, sc, Q_HEADER_BOLD);
            sx += text_width_sb(c2, sc);
        }
    }

    /* ---- 3D 球体 + thinking_focus 头像 (Q_AVATAR_SIZE 圆裁, 中心 Q_AVATAR_CX,CY) ---- */
    {
        int orbR = Q_ORB_R;
        int orbCx = Q_AVATAR_CX, orbCy = Q_AVATAR_CY;
        draw_avatar_orb(buf, orbCx, orbCy, orbR, COL_TRAE_GRN);
        int anim_size = Q_AVATAR_SIZE;
        int anim_x = orbCx - anim_size / 2;
        int anim_y = orbCy - anim_size / 2;
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

        /* ---- 动图边缘彩虹渐变线 (4px 厚, 随帧旋转) ---- */
        float rot = (float)s_quota_frame * 30.0f;  /* 12帧 × 30° = 360°/轮, 每帧旋转30° */
        draw_rainbow_ring(buf, orbCx, orbCy, Q_AVATAR_SIZE / 2, Q_AVATAR_SIZE / 2 + 4, rot);
    }

    /* ---- 套餐小字: 速通 PRO+ 单月 (中文16px缩小一半, ASCII 缩小到 8px, 双通道白色) ---- */
    draw_text_bgfg_center(buf, "速通 PRO+ 单月", Q_PLAN_Y, COL_WHITE, COL_WHITE, 1, 1);

    /* ---- 双 meter: 已用/剩余, pct+右值 用 px ---- */
    draw_meter(buf, Q_METER1_Y, "已用", QUOTA_USED_PCT,   "168/300", COL_TRAE_GRN,  Q_METER_VAL_PX);
    draw_meter(buf, Q_METER2_Y, "剩余", QUOTA_REMAIN_PCT, "132次",   COL_BRIGHT_GR, Q_METER_VAL_PX);

    /* ---- 中心主信息: 可用 132 次 (scale3增大, 中文白色 + 数字纯绿 COL_TRAE_GRN) ---- */
    {
        char num[8];
        int sc = SC_FROM_PX(Q_MAIN_PX);
        snprintf(num, sizeof(num), "%d", QUOTA_REMAIN);
        char line[32];
        snprintf(line, sizeof(line), "可用 %s 次", num);
        draw_text_bgfg_center(buf, line, Q_MAIN_Y, COL_WHITE, COL_TRAE_GRN, sc, 1);
    }

    /* ---- 日期时间 (两行: 上行时间+日期 scale=2, 下行周X scale=1 缩小, 白色, 冒号闪烁) ---- */
    {
        const char *wd_names[] = {"周日","周一","周二","周三","周四","周五","周六"};
        /* 半透明背景条 (上移 + 增高适配两行) */
        int y = LCD_V_RES - 70;
        for (int yy = y - 4; yy < y + 52; yy++) {
            if (yy < 0 || yy >= LCD_V_RES) continue;
            for (int xx = 50; xx < LCD_H_RES - 50; xx++) {
                int dx = xx - CENTER_X, dy = yy - CENTER_Y;
                if (dx * dx + dy * dy > (SCREEN_RADIUS - 2) * (SCREEN_RADIUS - 2)) continue;
                uint16_t v = buf[yy * LCD_H_RES + xx];
                uint8_t r = (v >> 11) & 0x1F, g = (v >> 5) & 0x3F, b = v & 0x1F;
                r = r / 3; g = g / 3; b = b / 3;
                buf[yy * LCD_H_RES + xx] = (r << 11) | (g << 5) | b;
            }
        }
        /* 上行: HH:MM MM/DD (scale=2, 冒号闪烁) */
        char line1[16];
        char sep = (s_dt.sec & 1) ? ':' : ' ';
        snprintf(line1, sizeof(line1), "%02d%c%02d %02d/%02d",
                 s_dt.hour, sep, s_dt.min, s_dt.month, s_dt.day);
        int tw1 = text_width_sb(line1, 2);
        draw_text_sb(buf, line1, (LCD_H_RES - tw1) / 2, y, COL_WHITE, 2, 1);
        /* 下行: 周X (scale=1 单通道 32px, 白色) — 回到上一版本 */
        {
            const char *wd = wd_names[s_dt.weekday];
            int twd = text_width_sb(wd, 1);
            draw_text_sb(buf, wd, (LCD_H_RES - twd) / 2, y + 36, COL_WHITE, 1, 0);
        }
    }
}

/* ========== 手表面 (数字时钟 + 绿色外环刻度 + 时针分针) ========== */
static void draw_watch(void)
{
    uint16_t *buf = (uint16_t *)s_frame_buf;
    /* 纯黑背景 */
    fill_rect(buf, 0, 0, LCD_H_RES, LCD_V_RES, COL_BLACK);
    update_datetime();

    /* ---- 60 个分刻度 (每 6°): 细暗绿线段 r=205→210 ---- */
    for (int i = 0; i < 60; i++) {
        float rad = (i * 6 - 90) * M_PI / 180.0f;
        int x1 = CENTER_X + (int)(205.0f * cosf(rad));
        int y1 = CENTER_Y + (int)(205.0f * sinf(rad));
        int x2 = CENTER_X + (int)(210.0f * cosf(rad));
        int y2 = CENTER_Y + (int)(210.0f * sinf(rad));
        draw_line(buf, x1, y1, x2, y2, COL_DARK_GR);
    }
    /* ---- 12 个主刻度 (每 30°): 粗绿色线段 r=195→215 ---- */
    for (int i = 0; i < 12; i++) {
        float rad = (i * 30 - 90) * M_PI / 180.0f;
        int x1 = CENTER_X + (int)(195.0f * cosf(rad));
        int y1 = CENTER_Y + (int)(195.0f * sinf(rad));
        int x2 = CENTER_X + (int)(215.0f * cosf(rad));
        int y2 = CENTER_Y + (int)(215.0f * sinf(rad));
        draw_line(buf, x1, y1, x2, y2, COL_TRAE_GRN);
    }
    /* ---- 12 数字刻度 (1-12) scale=2 灰白, r=178 ---- */
    for (int h = 1; h <= 12; h++) {
        float rad = (h * 30 - 90) * M_PI / 180.0f;
        int x = CENTER_X + (int)(178.0f * cosf(rad));
        int y = CENTER_Y + (int)(178.0f * sinf(rad));
        char num[4];
        snprintf(num, sizeof(num), "%d", h);
        int w = text_width_sb(num, 2);
        draw_text_sb(buf, num, x - w / 2, y - 16, COL_GRAY, 2, 0);
    }

    /* ---- 时针 (r=0→120, 延长到中心, 加粗一倍 6条线) ---- */
    {
        float ha = (s_dt.hour % 12) * 30.0f + s_dt.min * 0.5f;
        float rad = (ha - 90) * M_PI / 180.0f;
        int ex = CENTER_X + (int)(120.0f * cosf(rad));
        int ey = CENTER_Y + (int)(120.0f * sinf(rad));
        /* 加粗一倍: 左右各偏移 1→2 像素 (原3条→6条, 含垂直方向加粗) */
        for (int dx = -2; dx <= 2; dx++) {
            draw_line(buf, CENTER_X + dx, CENTER_Y, ex + dx, ey, COL_WHITE);
        }
        draw_line(buf, CENTER_X, CENTER_Y - 2, ex, ey - 2, COL_WHITE);
        draw_line(buf, CENTER_X, CENTER_Y + 2, ex, ey + 2, COL_WHITE);
    }
    /* ---- 分针 (r=0→155, 延长到中心, 加粗一倍 6条线) ---- */
    {
        float ma = s_dt.min * 6.0f + s_dt.sec * 0.1f;
        float rad = (ma - 90) * M_PI / 180.0f;
        int ex = CENTER_X + (int)(155.0f * cosf(rad));
        int ey = CENTER_Y + (int)(155.0f * sinf(rad));
        for (int dx = -2; dx <= 2; dx++) {
            draw_line(buf, CENTER_X + dx, CENTER_Y, ex + dx, ey, COL_BRIGHT_GR);
        }
        draw_line(buf, CENTER_X, CENTER_Y - 2, ex, ey - 2, COL_BRIGHT_GR);
        draw_line(buf, CENTER_X, CENTER_Y + 2, ex, ey + 2, COL_BRIGHT_GR);
    }

    /* ---- 中心数字时间 HH:MM (scale=4, bold, 白色), y=225 ---- */
    {
        char tbuf[8];
        snprintf(tbuf, sizeof(tbuf), "%02d:%02d", s_dt.hour, s_dt.min);
        draw_text_center_sb(buf, tbuf, 225, COL_WHITE, 4, 1);
    }

    /* ---- 时钟下方绿色 TRAE (scale=2), y=296 ---- */
    {
        int tw = text_width_sb("TRAE", 2);
        draw_text_sb(buf, "TRAE", (LCD_H_RES - tw) / 2, 296, COL_TRAE_GRN, 2, 1);
    }

    /* ---- 秒针指示: 外环上绿色圆点 r=200 ---- */
    {
        float rad = (s_dt.sec * 6 - 90) * M_PI / 180.0f;
        int x = CENTER_X + (int)(200.0f * cosf(rad));
        int y = CENTER_Y + (int)(200.0f * sinf(rad));
        fill_circle(buf, x, y, 5, COL_TRAE_GRN);
    }

    /* ---- 下方日期: YYYY/MM/DD 周X (scale=1, 灰白), y=340 (避开 TRAE 下移) ---- */
    {
        const char *wd_names[] = {"周日","周一","周二","周三","周四","周五","周六"};
        char line[32];
        snprintf(line, sizeof(line), "%04d/%02d/%02d %s",
                 s_dt.year, s_dt.month, s_dt.day, wd_names[s_dt.weekday]);
        draw_text_bgfg_center(buf, line, 340, COL_GRAY, COL_GRAY, 1, 0);
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
                vTaskDelay(pdMS_TO_TICKS(25));  /* 40fps, 配合弧填充动画 20帧/500ms */
                break;

            case PAGE_WATCH:
                draw_watch();
                flush_framebuffer();
                vTaskDelay(pdMS_TO_TICKS(50));  /* 20fps 够用 */
                break;

            case PAGE_PROJECT:
                draw_project_menu();
                flush_framebuffer();
                vTaskDelay(pdMS_TO_TICKS(50));
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
            /* 项目子菜单: 实时高亮 (主网格/子列表二选一) */
            if (page == PAGE_PROJECT && !long_pressed) {
                const submenu_t *m = &s_submenus[s_current_submenu];
                int hit = m->is_grid ? hit_test_grid(tx, ty) : hit_test_list(tx, ty);
                xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                s_menu_highlight = hit;
                xSemaphoreGive(s_state_mutex);
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
                continue;
            }

            xSemaphoreTake(s_state_mutex, portMAX_DELAY);
            s_menu_highlight = -1;
            xSemaphoreGive(s_state_mutex);

            /* 长按已触发则跳过其他手势 */
            if (long_pressed) {
                continue;
            }

            /* 点击 (小位移 + 短时间) → 菜单页/项目子菜单点击按钮 */
            if (dist2 < 400 && duration < 500) {
                if (page == PAGE_MENU) {
                    int hit = hit_test_menu(last_x, last_y);
                    if (hit >= 0) {
                        xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                        s_current_page = s_menu_items[hit].target_page;
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
                } else if (page == PAGE_PROJECT) {
                    /* 项目子菜单: 主网格点击进入子菜单, 列表点击切换状态/返回 */
                    const submenu_t *m = &s_submenus[s_current_submenu];
                    /* 顶栏返回按钮优先 (子菜单时) */
                    if (m->parent >= 0 && hit_test_top_back(last_x, last_y)) {
                        xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                        s_current_submenu = m->parent;
                        s_menu_highlight = -1;
                        xSemaphoreGive(s_state_mutex);
                        ESP_LOGI(TAG, "顶栏返回 → 子菜单 %d", m->parent);
                    } else if (m->is_grid) {
                        /* 主网格: 6 项按钮, 进入对应子菜单 */
                        int hit = hit_test_grid(last_x, last_y);
                        if (hit >= 0 && hit < 6) {
                            xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                            s_current_submenu = s_project_items[hit].target_submenu;
                            s_menu_highlight = -1;
                            xSemaphoreGive(s_state_mutex);
                            ESP_LOGI(TAG, "项目网格点击 %d → 子菜单 %d", hit, s_project_items[hit].target_submenu);
                        }
                    } else {
                        /* 列表: 子菜单项点击 (最后一项固定为"返回主菜单") */
                        int hit = hit_test_list(last_x, last_y);
                        if (hit >= 0) {
                            xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                            if (hit == m->item_count - 1) {
                                /* 返回主菜单 */
                                s_current_submenu = SUB_MAIN;
                            } else {
                                /* 其他项进入状态页演示 (复用 PAGE_STATUS) */
                                s_current_page = PAGE_STATUS;
                                s_state_index = 0;
                                s_status_frame = 0;
                            }
                            s_menu_highlight = -1;
                            xSemaphoreGive(s_state_mutex);
                            ESP_LOGI(TAG, "子菜单列表点击 %d", hit);
                        }
                    }
                }
            }
            /* 上滑 (dy < -80): 子页面→Menu, Menu→Ready, Ready→Menu, Quota/Watch→Ready */
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
                    s_current_page = PAGE_READY;
                    s_ready_frame = 0;
                    ESP_LOGI(TAG, "上滑 → 待机 (从会员额度)");
                } else if (page == PAGE_WATCH) {
                    s_current_page = PAGE_READY;
                    s_ready_frame = 0;
                    ESP_LOGI(TAG, "上滑 → 待机 (从手表)");
                } else if (page == PAGE_PROJECT) {
                    if (s_current_submenu != SUB_MAIN) {
                        s_current_submenu = SUB_MAIN;
                        s_menu_highlight = -1;
                        ESP_LOGI(TAG, "上滑 → 项目主网格 (从子菜单)");
                    } else {
                        s_current_page = PAGE_MENU;
                        ESP_LOGI(TAG, "上滑 → 主菜单 (从项目主网格)");
                    }
                } else {
                    s_current_page = PAGE_MENU;
                    ESP_LOGI(TAG, "上滑 → 菜单 (从子页面返回)");
                }
                xSemaphoreGive(s_state_mutex);
            }
            /* 左滑 (dx < -60): Ready→手表, 状态页下一个状态 */
            else if (dx < -60 && abs(dx) > abs(dy)) {
                if (page == PAGE_READY) {
                    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                    s_current_page = PAGE_WATCH;
                    xSemaphoreGive(s_state_mutex);
                    ESP_LOGI(TAG, "左滑 → 手表面");
                } else if (page == PAGE_STATUS) {
                    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                    s_state_index = (s_state_index + 1) % STATE_COUNT;
                    s_status_frame = 0;
                    xSemaphoreGive(s_state_mutex);
                    ESP_LOGI(TAG, "左滑 → 下一个状态 %d (%s)", s_state_index, state_names[s_state_index]);
                }
            }
            /* 右滑 (dx > 60): Ready→会员额度页, Watch→Ready, 状态页上一个状态 */
            else if (dx > 60 && abs(dx) > abs(dy)) {
                if (page == PAGE_READY) {
                    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                    s_current_page = PAGE_QUOTA;
                    s_quota_frame = 0;
                    s_quota_enter_tick = xTaskGetTickCount();
                    xSemaphoreGive(s_state_mutex);
                    ESP_LOGI(TAG, "右滑 → 会员额度页");
                } else if (page == PAGE_WATCH) {
                    xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                    s_current_page = PAGE_READY;
                    s_ready_frame = 0;
                    xSemaphoreGive(s_state_mutex);
                    ESP_LOGI(TAG, "右滑 → 待机 (从手表)");
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
