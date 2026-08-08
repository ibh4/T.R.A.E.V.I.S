"""
TRAE 速通额度查询 - Python 示例
用于硬件设备集成调用
"""

import subprocess
import json
import sys

def get_trae_credits(script_path=None):
    """
    调用 Node.js 脚本获取 TRAE 速通额度
    
    Args:
        script_path: edge-check.js 脚本路径，默认使用相对路径
    
    Returns:
        dict: 包含 success, fastPass, timestamp 字段的字典
    """
    if script_path is None:
        # 默认路径：trae-credits-monitor/src/edge-check.js
        import os
        base_dir = os.path.dirname(os.path.abspath(__file__))
        script_path = os.path.join(base_dir, 'src', 'edge-check.js')
    
    try:
        result = subprocess.run(
            ['node', script_path],
            cwd=os.path.dirname(script_path),
            capture_output=True,
            text=True,
            timeout=60
        )
        
        # 解析 JSON 输出
        for line in result.stdout.split('\n'):
            line = line.strip()
            if line.startswith('{'):
                data = json.loads(line)
                return data
        
        # 如果没有找到 JSON，尝试解析 stderr
        if result.stderr:
            return {
                'success': False,
                'error': result.stderr,
                'code': 'EXECUTION_ERROR'
            }
        
        return {
            'success': False,
            'error': '未能获取有效输出',
            'code': 'PARSE_ERROR'
        }
        
    except subprocess.TimeoutExpired:
        return {
            'success': False,
            'error': '执行超时',
            'code': 'TIMEOUT'
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'code': 'UNKNOWN_ERROR'
        }

def main():
    """主函数"""
    print("正在查询 TRAE 速通额度...")
    
    credits = get_trae_credits()
    
    if credits['success']:
        remaining = credits['fastPass']['remaining']
        print(f"\n✅ 查询成功！")
        print(f"   剩余速通次数: {remaining} 次")
        print(f"   查询时间: {credits['timestamp']}")
        
        # 低额度告警
        if remaining < 10:
            print(f"\n⚠️  警告：速通额度不足 10 次！")
            # 这里可以添加发送告警的逻辑
        
        return 0
    else:
        print(f"\n❌ 查询失败：{credits.get('error', '未知错误')}")
        print(f"   错误码：{credits.get('code', 'UNKNOWN')}")
        return 1

if __name__ == '__main__':
    sys.exit(main())
