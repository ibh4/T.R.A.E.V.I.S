#!/usr/bin/env python3
"""gen_font_atlas.py - 生成中文点阵字库 atlas.bin (v4)

格式: 每字 32x32 alpha mask = 1024 bytes/字 (v3 是 24x24=576, 增大33%)
字体: Hiragino Sans GB (苹果系统自带黑体, 更现代美观)
ESP32 端用 index * 1024 偏移读取, 配合 color 渲染
"""
from PIL import Image, ImageDraw, ImageFont
import os

# 项目用到的所有中文字 (去重, 顺序就是 ESP32 端查表顺序)
# v5: 演示版圆屏 UI, 32x32 字库, 覆盖所有页面文字
CHINESE_CHARS = (
    "药物研发智能体集合"          # 项目描述
    "虚拟筛选分子设计蛋白构象"      # 三个任务
    "生成训练对接失败完成提交结果"  # 任务动作
    "等待启动任务执行中错误告警修复成功"  # 状态
    "运行重跑下一当前选择确认取消返回上级"  # 菜单操作
    "主菜单进度总结状态详情"        # UI 文字
    "项目离线版本关于"             # 标题
    "数据准备模型评估参数优化"      # 子任务
    "操作精度触摸滑后退步"          # 补全
    "药靶点预测结合亲和力度量"      # 专业
    "构象多样性采样"               # 专业
    "测试演示应用系统设置间"        # 通用
    "连接准备待机入页面试"          # 演示版 UI
    "蜘蛛能量异关于扫描聚焦脉冲荷"  # 状态名
    "休眠迷宫圆形离屏界面"          # 其他
    "设备屏幕模式动画帧率亮度"      # 设置页
    "硬件存储内存处理器"           # 关于页
    "返回上级长按待机"             # 手势提示
    "会员额速通剩余已升级实际支付抵扣到期时权益名称金可使率有效方案价值月年日次今星期二三四五六秒周天元"  # 会员额度页 + 日期时间
)

# 去重保序
seen = set()
chars = []
for c in CHINESE_CHARS:
    if c not in seen:
        seen.add(c)
        chars.append(c)

print(f"中文字数: {len(chars)}")
print(f"字符集: {''.join(chars)}")

# 字体: Hiragino Sans GB (苹果系统自带, 比STHeiti更现代美观)
font_candidates = [
    "/System/Library/Fonts/Hiragino Sans GB.ttc",  # 冬青黑体 (首选, 苹果系统自带)
    "/System/Library/Fonts/STHeiti Medium.ttc",     # 华文黑体
]
font_path = None
for p in font_candidates:
    if os.path.exists(p):
        font_path = p
        break
if not font_path:
    print("ERROR: 找不到中文字体")
    exit(1)
print(f"使用字体: {font_path}")

# v4: 32x32 字库, 字号 34 (略大于32确保填满)
FONT_SIZE = 34
CELL_SIZE = 32
font = ImageFont.truetype(font_path, FONT_SIZE)

# 渲染每个字为 32x32 alpha mask
atlas_bytes = bytearray()
for ch in chars:
    img = Image.new('L', (CELL_SIZE, CELL_SIZE), 0)
    draw = ImageDraw.Draw(img)
    # 居中绘制
    bbox = draw.textbbox((0, 0), ch, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = (CELL_SIZE - w) // 2 - bbox[0]
    y = (CELL_SIZE - h) // 2 - bbox[1]
    draw.text((x, y), ch, fill=255, font=font)
    atlas_bytes.extend(list(img.getdata()))

out_path = os.path.join(os.path.dirname(__file__), 'font_atlas.bin')
with open(out_path, 'wb') as f:
    f.write(bytes(atlas_bytes))

BYTES_PER_CHAR = CELL_SIZE * CELL_SIZE
print(f"字库写入: {out_path}")
print(f"大小: {len(atlas_bytes)} bytes = {len(chars)} * {BYTES_PER_CHAR}")
print(f"  (= {len(atlas_bytes)/1024:.1f} KB)")

# 同时写一份字符表给 C 代码参考
chars_path = os.path.join(os.path.dirname(__file__), 'font_chars.txt')
with open(chars_path, 'w', encoding='utf-8') as f:
    for i, c in enumerate(chars):
        f.write(f"{i:3d}: {c}\n")
print(f"字符表: {chars_path}")

# 校验: 检查所有菜单文字是否都在字库里
test_strings = [
    "筛选", "设计", "构象", "状态", "操作", "关于",
    "数据准备", "模型训练", "结果提交", "返回主菜单",
    "vina 对接", "参数优化", "v39 精度", "多样性采样",
    "idle 等待", "task 执行", "bug 告警", "fix 成功",
    "选择操作", "运行下一步", "重跑当前stage",
    "项目状态", "ai4s_chem 离线版", "DrugCLIP 筛选",
    # 演示版 UI
    "连接中", "上滑进入菜单", "菜单", "待机", "扫描", "聚焦",
    "告警", "修复", "脉冲", "任务", "蜘蛛", "休眠", "迷宫",
    "设置", "关于", "设备", "屏幕", "演示", "应用", "动画",
    "圆形屏界面", "离线版本", "返回上级", "长按待机",
    # 会员额度页
    "会员额度", "速通", "剩余", "已用", "升级", "实际支付", "抵扣",
    "到期时间", "权益名称", "金额", "可用", "使用率", "有效期",
    "方案价值", "年月日时分秒", "今天星期", "周二周四周五周六",
    "单月", "次数",
]
print("\n=== 字库完整性校验 ===")
all_ok = True
for s in test_strings:
    missing = [c for c in s if c not in chars and ord(c) > 127]
    if missing:
        print(f"  缺字: '{s}' -> {missing}")
        all_ok = False
if all_ok:
    print("  所有菜单文字均在字库中 ✓")
