idf_component_register(
    SRCS main.c wifi_tcp.c
    INCLUDE_DIRS .
    REQUIRES esp_wifi esp_event esp_netif lwip nvs_flash
)

# 烧录 delta patch 压缩帧 (电子蜘蛛 3 状态 × 8 帧) 到 "frames" 分区
esptool_py_flash_to_partition(flash "frames" "${CMAKE_CURRENT_LIST_DIR}/../frames_spider.bin")
