/* wifi_tcp.c - WiFi AP + TCP server
 * ESP32 创建 WiFi AP, 电脑连接后通过 TCP 3333 发送状态命令
 * AP 模式确保直连通信, 不受路由器 AP 隔离影响
 */
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_netif.h"
#include "lwip/sockets.h"
#include "wifi_tcp.h"

static const char *TAG = "WIFI_TCP";

#define WIFI_AP_SSID    "TraePal"
#define WIFI_AP_PASS    "12345678"
#define WIFI_AP_CHANNEL 5
#define WIFI_AP_MAX_CONN 2
#define TCP_PORT        3333
#define TCP_BUF_SIZE    512
#define AP_READY_BIT    BIT0

static char s_ip_str[16] = "192.168.4.1";
static int  s_client_count = 0;
static void (*s_on_msg)(const char *msg, int len) = NULL;
static EventGroupHandle_t s_wifi_event_group;

const char *wifi_tcp_get_ip(void) { return s_ip_str; }
int wifi_tcp_get_client_count(void) { return s_client_count; }

/* TCP server task: 接受连接, 收文字回调 */
static void tcp_server_task(void *arg)
{
    int listen_sock = socket(AF_INET, SOCK_STREAM, IPPROTO_IP);
    if (listen_sock < 0) {
        ESP_LOGE(TAG, "socket 创建失败: errno %d", errno);
        vTaskDelete(NULL);
        return;
    }

    int opt = 1;
    setsockopt(listen_sock, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));

    struct sockaddr_in dest = {
        .sin_family = AF_INET,
        .sin_port = htons(TCP_PORT),
        .sin_addr.s_addr = htonl(INADDR_ANY),
    };
    if (bind(listen_sock, (struct sockaddr *)&dest, sizeof(dest)) != 0) {
        ESP_LOGE(TAG, "bind 失败: errno %d", errno);
        close(listen_sock);
        vTaskDelete(NULL);
        return;
    }
    if (listen(listen_sock, 2) != 0) {
        ESP_LOGE(TAG, "listen 失败: errno %d", errno);
        close(listen_sock);
        vTaskDelete(NULL);
        return;
    }
    ESP_LOGI(TAG, "TCP server 监听端口 %d", TCP_PORT);

    char rx_buf[TCP_BUF_SIZE];
    while (1) {
        struct sockaddr_in src;
        socklen_t addrlen = sizeof(src);
        int sock = accept(listen_sock, (struct sockaddr *)&src, &addrlen);
        if (sock < 0) {
            ESP_LOGE(TAG, "accept 失败: errno %d", errno);
            continue;
        }
        s_client_count++;
        ESP_LOGI(TAG, "电脑连接: %s (共 %d 个)",
                 inet_ntoa(src.sin_addr), s_client_count);

        const char *welcome = "TraePal ready\r\n";
        send(sock, welcome, strlen(welcome), 0);

        while (1) {
            int len = recv(sock, rx_buf, sizeof(rx_buf) - 1, 0);
            if (len < 0) {
                ESP_LOGE(TAG, "recv 失败: errno %d", errno);
                break;
            } else if (len == 0) {
                ESP_LOGI(TAG, "电脑断开");
                break;
            }
            rx_buf[len] = '\0';
            while (len > 0 && (rx_buf[len-1] == '\n' || rx_buf[len-1] == '\r')) {
                rx_buf[--len] = '\0';
            }
            if (len > 0 && s_on_msg) {
                s_on_msg(rx_buf, len);
            }
        }
        close(sock);
        s_client_count--;
    }
    close(listen_sock);
    vTaskDelete(NULL);
}

/* WiFi 事件回调 */
static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data)
{
    if (event_id == WIFI_EVENT_AP_STACONNECTED) {
        ESP_LOGI(TAG, "设备连接 AP");
    } else if (event_id == WIFI_EVENT_AP_STADISCONNECTED) {
        ESP_LOGI(TAG, "设备断开 AP");
    } else if (event_id == WIFI_EVENT_AP_START) {
        ESP_LOGI(TAG, "AP 启动成功: SSID='%s'", WIFI_AP_SSID);
        xEventGroupSetBits(s_wifi_event_group, AP_READY_BIT);
    }
}

void wifi_tcp_start(void (*on_msg)(const char *msg, int len))
{
    s_on_msg = on_msg;

    /* 1. 初始化网络接口和事件循环 */
    esp_err_t ret = esp_netif_init();
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) {
        ESP_ERROR_CHECK(ret);
    }
    ret = esp_event_loop_create_default();
    if (ret != ESP_OK && ret != ESP_ERR_INVALID_STATE) {
        ESP_ERROR_CHECK(ret);
    }
    s_wifi_event_group = xEventGroupCreate();
    esp_netif_create_default_wifi_ap();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    ESP_ERROR_CHECK(esp_event_handler_instance_register(
        WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL, NULL));

    /* 2. 配置 AP */
    wifi_config_t wifi_config = {
        .ap = {
            .ssid = WIFI_AP_SSID,
            .ssid_len = strlen(WIFI_AP_SSID),
            .channel = WIFI_AP_CHANNEL,
            .password = WIFI_AP_PASS,
            .max_connection = WIFI_AP_MAX_CONN,
            .authmode = WIFI_AUTH_WPA2_PSK,
        },
    };
    if (strlen(WIFI_AP_PASS) == 0) {
        wifi_config.ap.authmode = WIFI_AUTH_OPEN;
    }

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "WiFi AP 启动: SSID='%s' 密码='%s' 通道=%d",
             WIFI_AP_SSID, WIFI_AP_PASS, WIFI_AP_CHANNEL);
    ESP_LOGI(TAG, "电脑请连接 WiFi '%s', 然后发送 TCP 到 %s:%d",
             WIFI_AP_SSID, s_ip_str, TCP_PORT);

    /* 3. 启动 TCP server task */
    xTaskCreate(tcp_server_task, "tcp_server", 4096, NULL, 5, NULL);
}
