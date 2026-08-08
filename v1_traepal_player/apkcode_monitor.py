#!/usr/bin/env python3
"""
Apkcode 项目状态监测 → ESP32 TraePal 显示

ESP32 运行在 AP 模式 (SSID: TraePal, IP: 192.168.4.1:3333)。
电脑连接 TraePal WiFi 后运行此脚本, TCP 连接 ESP32 推送状态命令。

监测 /Users/pwngwc/Apkcode 下各子项目的:
  - 源码文件变化  → idle_ready (活跃工作中)
  - git 新 commit → fix_success (提交成功, 8 秒后回 idle)
  - build 错误    → bug_alert (构建失败, 8 秒后回 idle)

支持手动命令: bug / fix / idle / demo / quit
"""
import socket
import time
import os
import sys
import subprocess
import threading

ESP32_IP = '192.168.4.1'    # ESP32 AP 模式默认 IP
ESP32_PORT = 3333
WATCH_DIR = '/Users/pwngwc/Apkcode'
SCAN_INTERVAL = 3            # 文件扫描间隔 (秒)
TRANSIENT_DURATION = 8.0     # bug/fix 状态持续时间, 之后回 idle

# 监听的源码扩展名
WATCH_EXTS = {'.kt', '.java', '.ts', '.tsx', '.js', '.jsx',
              '.gradle', '.kts', '.xml', '.json', '.py', '.sh', '.md'}
# 扫描时跳过的目录名
SKIP_DIRS = {'.git', 'node_modules', 'build', '.gradle', 'dist',
             '__pycache__', '.idea', '.cache', 'target', 'bin', 'obj'}


class ApkcodeMonitor:
    def __init__(self):
        self.sock = None
        self.current_state = None
        self.last_activity = time.time()
        self.transient_until = 0.0
        self.git_heads = {}
        self.file_mtimes = {}
        self.lock = threading.Lock()

    # ---------- TCP ----------
    def connect(self):
        try:
            if self.sock:
                try:
                    self.sock.close()
                except OSError:
                    pass
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.settimeout(5)
            self.sock.connect((ESP32_IP, ESP32_PORT))
            self.current_state = None  # 重连后重发状态
            print(f'[TCP] 已连接 {ESP32_IP}:{ESP32_PORT}')
            return True
        except Exception as e:
            print(f'[TCP] 连接失败: {e}')
            self.sock = None
            return False

    def send_state(self, state, force=False):
        with self.lock:
            if state == self.current_state and not force:
                return
            if not self.sock:
                if not self.connect():
                    return
            try:
                self.sock.sendall(state.encode())
                self.current_state = state
                tag = {'idle_ready': 'IDLE', 'bug_alert': 'BUG',
                       'fix_success': 'FIX'}.get(state, state)
                print(f'[→ ESP32] {tag}  ({time.strftime("%H:%M:%S")})')
            except Exception as e:
                print(f'[TCP] 发送失败: {e}')
                self.sock = None
                self.current_state = None

    # ---------- 文件扫描 ----------
    def scan_source_files(self):
        now = time.time()
        recent_count = 0
        latest_mtime = 0.0
        changed = False
        for root, dirs, files in os.walk(WATCH_DIR):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
            depth = root[len(WATCH_DIR):].count(os.sep)
            if depth > 3:
                dirs.clear()
                continue
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                if ext not in WATCH_EXTS:
                    continue
                path = os.path.join(root, f)
                try:
                    mtime = os.path.getmtime(path)
                except OSError:
                    continue
                if mtime > latest_mtime:
                    latest_mtime = mtime
                if now - mtime < 5:
                    recent_count += 1
                old = self.file_mtimes.get(path)
                if old is not None and mtime != old:
                    changed = True
                self.file_mtimes[path] = mtime
        return recent_count, latest_mtime, changed

    # ---------- git 监测 ----------
    def scan_git(self):
        new_commit = False
        try:
            entries = os.listdir(WATCH_DIR)
        except OSError:
            return False
        for name in entries:
            sub = os.path.join(WATCH_DIR, name)
            git_dir = os.path.join(sub, '.git')
            if not os.path.isdir(git_dir):
                continue
            try:
                r = subprocess.run(
                    ['git', '-C', sub, 'log', '-1', '--format=%H'],
                    capture_output=True, text=True, timeout=5)
                if r.returncode != 0:
                    continue
                head = r.stdout.strip()
                old = self.git_heads.get(name)
                if old is not None and head != old:
                    new_commit = True
                    print(f'[GIT] {name} 新 commit: {head[:8]}')
                self.git_heads[name] = head
            except Exception:
                pass
        return new_commit

    # ---------- build 错误检测 ----------
    def scan_build_errors(self):
        now = time.time()
        try:
            entries = os.listdir(WATCH_DIR)
        except OSError:
            return False
        for name in entries:
            sub = os.path.join(WATCH_DIR, name)
            if not os.path.isdir(sub):
                continue
            for report_path in [
                os.path.join(sub, 'app', 'build', 'reports'),
                os.path.join(sub, 'build', 'reports'),
            ]:
                if not os.path.isdir(report_path):
                    continue
                for root, dirs, files in os.walk(report_path):
                    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
                    for f in files:
                        if 'fail' in f.lower() or 'error' in f.lower():
                            try:
                                mtime = os.path.getmtime(os.path.join(root, f))
                                if now - mtime < 10:
                                    return True
                            except OSError:
                                pass
        return False

    # ---------- 主监测循环 ----------
    def monitor_loop(self):
        print(f'[监控] 开始监测 {WATCH_DIR}')
        self.scan_git()
        self.send_state('idle_ready', force=True)

        while True:
            now = time.time()
            if self.transient_until > 0 and now >= self.transient_until:
                self.transient_until = 0
                self.send_state('idle_ready')

            recent, latest, changed = self.scan_source_files()
            if recent > 0 or changed:
                self.last_activity = now
                if self.transient_until == 0:
                    self.send_state('idle_ready')

            if int(now) % 10 == 0:
                if self.scan_git():
                    self.transient_until = now + TRANSIENT_DURATION
                    self.send_state('fix_success')

            if int(now) % 5 == 0:
                if self.scan_build_errors():
                    self.transient_until = now + TRANSIENT_DURATION
                    self.send_state('bug_alert')

            time.sleep(SCAN_INTERVAL)

    # ---------- 手动命令 ----------
    def input_loop(self):
        help_text = ('命令: bug=BUG_ALERT  fix=FIX_SUCCESS  idle=IDLE_READY'
                     '  demo=循环演示  quit=退出')
        print(help_text)
        while True:
            try:
                cmd = input().strip().lower()
            except (EOFError, KeyboardInterrupt):
                print('\n退出')
                sys.exit(0)
            if cmd in ('bug', 'bug_alert'):
                self.transient_until = time.time() + TRANSIENT_DURATION
                self.send_state('bug_alert', force=True)
            elif cmd in ('fix', 'fix_success', 'success'):
                self.transient_until = time.time() + TRANSIENT_DURATION
                self.send_state('fix_success', force=True)
            elif cmd in ('idle', 'idle_ready'):
                self.transient_until = 0
                self.send_state('idle_ready', force=True)
            elif cmd == 'demo':
                self.run_demo()
            elif cmd == 'quit':
                sys.exit(0)
            elif cmd:
                print(help_text)

    def run_demo(self):
        print('[DEMO] 3 秒后开始循环演示 idle→bug→fix...')
        threading.Thread(target=self._demo_thread, daemon=True).start()

    def _demo_thread(self):
        for state in ['idle_ready', 'bug_alert', 'fix_success']:
            time.sleep(3)
            self.transient_until = time.time() + 2.5
            self.send_state(state, force=True)
        time.sleep(3)
        self.transient_until = 0
        self.send_state('idle_ready', force=True)
        print('[DEMO] 演示结束')


if __name__ == '__main__':
    mon = ApkcodeMonitor()
    t = threading.Thread(target=mon.monitor_loop, daemon=True)
    t.start()
    mon.input_loop()
