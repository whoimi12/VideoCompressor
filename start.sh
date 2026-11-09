#!/usr/bin/env bash

cd "$(dirname "$0")"

echo "==================================================="
echo "  Video Compressor - Khởi động"
echo "==================================================="
echo ""

if ! command -v node >/dev/null 2>&1; then
    echo "[Lỗi] Không tìm thấy Node.js. Hãy cài đặt bằng lệnh: pkg install nodejs"
    exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "[Cảnh báo] Không tìm thấy FFmpeg. Hãy cài bằng lệnh: pkg install ffmpeg"
    echo ""
fi

if [ ! -d "node_modules" ]; then
    echo "Đang cài đặt thư viện lần đầu, vui lòng đợi..."
    npm install --no-bin-links
    if [ $? -ne 0 ]; then
        echo "[Lỗi] Cài đặt thư viện thất bại."
        exit 1
    fi
fi

echo "Đang khởi động server tại http://localhost:3000"

if command -v termux-open-url >/dev/null 2>&1; then
    termux-open-url "http://localhost:3000"
else
    echo "Hãy mở trình duyệt và truy cập: http://localhost:3000"
fi

node server.js

read -p "Nhấn Enter để thoát..."
