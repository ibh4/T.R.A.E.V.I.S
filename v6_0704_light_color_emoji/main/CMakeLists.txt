idf_component_register(
    SRCS main.c
    INCLUDE_DIRS .
    REQUIRES nvs_flash esp_lcd_touch esp32_s3_touch_amoled_1_75c
)

# 10 状态动画 (13.5MB, 240x240 全屏帧) → states 分区
esptool_py_flash_to_partition(flash "states" "${CMAKE_CURRENT_LIST_DIR}/../states_anim.bin")

# 中文字库 (164KB, 32x32) → font 分区
esptool_py_flash_to_partition(flash "font" "${CMAKE_CURRENT_LIST_DIR}/../font_atlas.bin")
