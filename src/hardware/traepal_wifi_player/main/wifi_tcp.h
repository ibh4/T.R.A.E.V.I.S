/* wifi_tcp.h - WiFi AP + TCP server */
#pragma once

#include "esp_err.h"

/* 启动 WiFi AP + TCP server, 电脑连接后发送状态命令 */
void wifi_tcp_start(void (*on_msg)(const char *msg, int len));

/* 获取 AP 的 IP 地址字符串 */
const char *wifi_tcp_get_ip(void);

/* 获取连接的电脑数量 */
int wifi_tcp_get_client_count(void);
