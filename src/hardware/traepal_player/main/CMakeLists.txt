idf_component_register(
    SRCS main.c wifi_tcp.c
    INCLUDE_DIRS .
    REQUIRES esp_wifi esp_event esp_netif lwip nvs_flash
)

# 烧录 raw frames.bin (3 状态 x 8 帧全屏 RGB565) 到 "frames" 分区
# idf.py flash 时自动烧录
esptool_py_flash_to_partition(flash "frames" "${CMAKE_CURRENT_LIST_DIR}/../frames.bin")
