# VideoCompressor

**VideoCompressor** là một ứng dụng có giao diện trực quan giúp nén video nhiều lần thông qua FFmpeg. Hỗ trợ đa nền tảng.

## ✨ Tính năng nổi bật
* **Nén nhiều lần:** Cho phép tối ưu dung lượng video qua nhiều lượt nén.
* **Giao diện trực quan:** Thao tác dễ dàng, thân thiện với người dùng.
* **Đa nền tảng:** Sử dụng mượt mà trên Windows, Linux, Android, MacOS,...
* **Sức mạnh FFmpeg:** Đảm bảo chất lượng video và tốc độ xử lý tối ưu. (Tốc độ xử lý phụ thuộc vào phần cứng)

## 🛠️ Yêu cầu hệ thống
* **Node.js** (đã cài đặt trên máy)
* **FFmpeg** (đã được cấu hình trong biến môi trường hệ thống)

## 🚀 Hướng dẫn cài đặt và chạy

1. **Tải mã nguồn về máy:**
   ```bash
   git clone https://github.com/whoimi12/VideoCompressor
   cd VideoCompressor
   ```
   (Hoặc tải về zip release rồi giải nén ra)

2. **Thiết lập và khởi chạy:**
   * **Trên Windows:** Chạy file `start.bat`.
   * **Trên Linux / macOS / Android (Termux), chạy lệnh:**
     ```bash
     bash start.sh
     ```

## 📂 Cấu trúc thư mục dự án
* `uploads/`: Chứa các video gốc tải lên để chuẩn bị nén.
* `temp/`: Chứa các tệp tin tạm thời trong quá trình xử lý.
* `outputs/`: Nơi lưu trữ video sau khi đã nén thành công.

## 📄 Giấy phép
Dự án này được phát hành dưới bản quyền **MIT License**.
