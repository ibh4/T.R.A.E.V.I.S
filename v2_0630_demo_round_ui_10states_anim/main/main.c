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
    draw_text_center_sb(buf, "上滑进入菜单", hint_y, COL_TRAE_GRN, 1, 1);
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
static void draw_menu(void)
{
    uint16_t *buf = (uint16_t *)s_frame_buf;
    draw_background();

    /* 中心装饰圆 + "菜单" (scale=1) */
    fill_circle(buf, CENTER_X, CENTER_Y, 36, COL_DEEP_BLK);
    draw_circle(buf, CENTER_X, CENTER_Y, 36, COL_TRAE_GRN);
    draw_text_center_sb(buf, "菜单", CENTER_Y - 16, COL_TRAE_GRN, 1, 1);

    /* 6 个径向菜单按钮 */
    for (int i = 0; i < 6; i++) {
        int bx = s_menu_items[i].x;
        int by = s_menu_items[i].y;
        int br = MENU_BTN_RADIUS;

        uint16_t bg, border, icon_col, text_col;
        if (i == s_menu_highlight) {
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

/* ========== UI 任务 ========== */
static void ui_task(void *arg)
{
    int spinner_step = 0;
    while (1) {
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
                flush_framebuffer();
                vTaskDelay(pdMS_TO_TICKS(30));  /* 33fps */
                break;

            case PAGE_MENU:
                draw_menu();
                flush_framebuffer();
                vTaskDelay(pdMS_TO_TICKS(80));
                break;

            case PAGE_STATUS:
                draw_status();
                flush_framebuffer();
                vTaskDelay(pdMS_TO_TICKS(30));  /* 动画 33fps */
                break;

            case PAGE_SPIDER:
                draw_spider();
                flush_framebuffer();
                vTaskDelay(pdMS_TO_TICKS(20));  /* 50fps 加速 */
                break;

            case PAGE_ALERT:
                draw_alert();
                flush_framebuffer();
                vTaskDelay(pdMS_TO_TICKS(80));
                break;

            case PAGE_ENERGY:
                draw_energy();
                flush_framebuffer();
                vTaskDelay(pdMS_TO_TICKS(80));
                break;

            case PAGE_SETTINGS:
                draw_settings();
                flush_framebuffer();
                vTaskDelay(pdMS_TO_TICKS(80));
                break;

            case PAGE_ABOUT:
                draw_about();
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

            /* 菜单页实时高亮 */
            if (page == PAGE_MENU && !long_pressed) {
                int hit = hit_test_menu(tx, ty);
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

            xSemaphoreTake(s_state_mutex, portMAX_DELAY);
            s_menu_highlight = -1;
            xSemaphoreGive(s_state_mutex);

            /* 长按已触发则跳过其他手势 */
            if (long_pressed) {
                continue;
            }

            /* 点击 (小位移 + 短时间) → 菜单页选择菜单项 */
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
            /* 上滑 (dy < -80): 子页面→Menu, Menu→Ready, Ready→Menu */
            else if (dy < -80 && abs(dy) > abs(dx)) {
                xSemaphoreTake(s_state_mutex, portMAX_DELAY);
                if (page == PAGE_READY) {
                    s_current_page = PAGE_MENU;
                    ESP_LOGI(TAG, "上滑 → 菜单");
                } else if (page == PAGE_MENU) {
                    s_current_page = PAGE_READY;
                    s_ready_frame = 0;
                    ESP_LOGI(TAG, "上滑 → 待机");
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
            /* 右滑 (dx > 60): 状态页上一个状态 */
            else if (dx > 60 && abs(dx) > abs(dy)) {
                if (page == PAGE_STATUS) {
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
