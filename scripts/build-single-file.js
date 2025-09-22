#!/usr/bin/env node

/**
 * 单文件构建脚本
 * 将整个应用打包为一个独立的HTML文件
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 解析命令行参数
const args = process.argv.slice(2);
const isPureSingle = args.includes('--pure-single');
const keepPWA = args.includes('--keep-pwa');

// 确定构建模式
let buildMode = 'default';
if (isPureSingle) {
    buildMode = 'pure';
} else if (keepPWA) {
    buildMode = 'pwa';
}

console.log('🚀 开始单文件构建...');
console.log('===========================================');
console.log(`📋 构建模式: ${getBuildModeDescription(buildMode)}`);

function getBuildModeDescription(mode) {
    switch (mode) {
        case 'pure': return '🎯 纯单文件模式 (只有index.html)';
        case 'pwa': return '📱 PWA模式 (完整PWA功能: SW + Manifest + 图标)';
        default: return '📦 默认模式 (禁用SW，保留基本Web App文件)';
    }
}

// 运行Vite构建
console.log('\n🔨 开始构建...');
try {
    // 设置环境变量传递构建模式
    const env = { ...process.env, BUILD_MODE: buildMode };
    execSync('npx vite build --config vite.config.js --logLevel info', {
        stdio: 'inherit',
        env: env
    });
    console.log('✅ Vite构建完成');
} catch (error) {
    console.error('❌ Vite构建失败:', error.message);
    process.exit(1);
}

// 检查构建结果
console.log('\n🔍 验证构建结果...');
const distPath = path.join(process.cwd(), 'dist');
const indexPath = path.join(distPath, 'index.html');

if (!fs.existsSync(indexPath)) {
    console.error('❌ 构建文件不存在:', indexPath);
    process.exit(1);
}

const stats = fs.statSync(indexPath);
const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);

console.log('✅ 构建验证完成');
console.log(`📦 单文件大小: ${fileSizeInMB} MB`);
console.log(`📂 输出位置: ${indexPath}`);

// 根据构建模式进行后处理
if (buildMode === 'pure') {
    console.log('\n🎯 纯单文件模式 - 清理额外文件...');

    // 删除除index.html以外的所有文件
    const files = fs.readdirSync(distPath);
    for (const file of files) {
        if (file !== 'index.html' && !file.startsWith('index-')) {
            const filePath = path.join(distPath, file);
            fs.unlinkSync(filePath);
            console.log(`🗑️ 删除文件: ${file}`);
        }
    }

    console.log('✅ 纯单文件清理完成 - 只有index.html');
}

// 可选：创建一个时间戳版本（可通过环境变量或命令行参数控制）
const createTimestampVersion = process.env.CREATE_TIMESTAMP !== 'false' && !args.includes('--no-timestamp');

if (createTimestampVersion) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const timestampPath = path.join(distPath, `index-${timestamp}.html`);

    try {
        fs.copyFileSync(indexPath, timestampPath);
        console.log(`🕒 时间戳版本: ${timestampPath}`);
    } catch (error) {
        console.warn('⚠️ 创建时间戳版本失败:', error.message);
    }
} else {
    console.log('⏭️ 跳过时间戳版本创建');
}

console.log('\n🎉 单文件构建完成！');
console.log('===========================================');
console.log('📝 使用说明:');
console.log('   1. 打开浏览器');
console.log('   2. 拖拽 index.html 到浏览器窗口');
console.log('   3. 或者使用 file:// 协议打开文件');
console.log('');
console.log('⚠️  注意事项:');
console.log('   - 某些功能可能因CORS限制而受影响');
console.log('   - ServiceWorker已在单文件模式下禁用');
console.log('   - 建议在本地服务器环境下测试完整功能');