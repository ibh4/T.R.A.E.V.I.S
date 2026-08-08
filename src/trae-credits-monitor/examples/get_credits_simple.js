/**
 * TRAE 速通额度查询 - 简化版示例
 */

const { spawn } = require('child_process');
const path = require('path');

async function getTraeCredits() {
  return new Promise((resolve) => {
    const scriptPath = path.join(__dirname, '..', 'src', 'edge-check.js');
    
    const child = spawn('node', [scriptPath], {
      cwd: path.dirname(scriptPath),
      shell: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      // 解析 JSON - 查找包含 { 到 } 的完整 JSON
      const jsonStart = stdout.indexOf('{');
      const jsonEnd = stdout.lastIndexOf('}');
      
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        const jsonStr = stdout.substring(jsonStart, jsonEnd + 1);
        try {
          const data = JSON.parse(jsonStr);
          resolve(data);
          return;
        } catch (e) {
          // JSON 解析失败，继续
        }
      }

      // 如果解析失败，返回错误
      resolve({
        success: false,
        error: stderr || stdout.substring(0, 200) || '未知错误',
        code: code === 0 ? 'PARSE_ERROR' : 'EXECUTION_ERROR'
      });
    });

    child.on('error', (err) => {
      resolve({
        success: false,
        error: err.message,
        code: 'SPAWN_ERROR'
      });
    });
  });
}

async function main() {
  console.log('正在查询 TRAE 速通额度...\n');

  const credits = await getTraeCredits();

  if (credits.success) {
    const remaining = credits.fastPass.remaining;
    console.log('✅ 查询成功！');
    console.log(`   剩余速通次数: ${remaining} 次`);
    console.log(`   查询时间: ${credits.timestamp}`);

    if (remaining < 10) {
      console.log('\n⚠️  警告：速通额度不足 10 次！');
    }

    return 0;
  } else {
    console.log(`❌ 查询失败：${credits.error}`);
    console.log(`   错误码：${credits.code}`);
    return 1;
  }
}

main().then(code => process.exit(code));
