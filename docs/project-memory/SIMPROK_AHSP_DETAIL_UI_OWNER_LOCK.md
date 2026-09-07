# SIMPROK — AHSP Detail UI Owner Lock

**Tanggal:** 2026-09-08  
**Status:** OWNER PASS — DESIGN LOCKED

## 1. Prinsip

Detail AHSP harus **sederhana, profesional, ringan, cepat, dan mudah dipahami**. Jangan menambah UI hanya agar terlihat lengkap. Jangan mengubah bagian yang sudah PASS tanpa alasan konkret.

## 2. Struktur yang dikunci

Pertahankan halaman Detail AHSP yang sudah ada sebagai baseline.

Tampilkan:
- identitas AHSP termasuk **Kode**;
- Jenis Pekerjaan;
- Uraian;
- Satuan;
- Bidang/Kategori dan Subkategori bila datanya memang tersedia;
- **Dasar AHSP** sebagai informasi regulasi/dasar AHSP;
- informasi sumber secara sederhana bila diperlukan: **AHSP Saya** atau **Katalog SIMPROK**;
- Keterangan/informasi relevan lainnya;
- **Komponen Pembentuk AHSP**.

Komponen hanya menampilkan informasi analisa yang relevan:
- kelompok Tenaga Kerja;
- kelompok Bahan;
- kelompok Peralatan;
- Uraian;
- Satuan;
- Koefisien.

**Harga Satuan dan Jumlah Harga bukan bagian dari detail komponen AHSP ini.** Harga ditangani pada jalur harga dan RAB yang sudah ada.

## 3. Aksi

- Jangan memiliki dua pintu untuk fungsi perubahan yang sama.
- **Update AHSP** tetap sebagai bagian/accordion yang sudah ada dan menjadi pintu perubahan AHSP.
- Jangan mempertahankan tombol **Edit** header sebagai pintu kedua bila fungsinya sama dengan Update AHSP.
- Update AHSP harus dapat mengubah informasi AHSP dan komponen pembentuknya, bukan hanya satuan/tanggal/komponen.
- **Usulkan ke SIMPROK** adalah aksi terpisah dan hanya ditampilkan ketika kondisi pengusulan memang berlaku. Usulan tidak sama dengan publikasi/kanonisasi otomatis.

## 4. Riwayat

Riwayat AHSP hanya menunjukkan sejarah perubahan yang berguna bagi pengguna, misalnya tanggal, jenis perubahan, pihak yang mengubah, keterangan, dan versi bila memang ada.

Jangan menampilkan log teknis/internal seperti UUID, endpoint, reason code, atau detail implementasi.

## 5. Yang tidak perlu

Jangan menambahkan:
- Terkait Penggunaan;
- Diskusi;
- Jejak Analisa sebagai panel utama;
- tab/panel tambahan tanpa kebutuhan nyata.

Jejak pembentukan/evidence AHSP tetap merupakan **knowledge internal SIMPROK**. UI teknis hanya dipertimbangkan kemudian jika sudah ada evidence-backed content yang benar-benar bermanfaat.

## 6. AHSP Intelligence Internal

SIMPROK perlu memahami secara internal komponen, koefisien, evidence, asumsi yang benar-benar terbukti, cakupan AHSP, dan hubungan dengan Execution Intelligence untuk mencegah double counting.

Gunakan prinsip:

**EXPENSIVE ONCE → COMPACT KNOWLEDGE + EVIDENCE → FAST MANY-TIMES USE**

Agent AI boleh melakukan pekerjaan pembelajaran/ekstraksi yang berat pada tahap ingestion/knowledge building. Runtime SIMPROK tidak boleh membaca ulang dokumen atau memanggil LLM setiap kali user membuka AHSP atau melakukan perhitungan.

Jika alasan suatu koefisien tidak tersedia dalam evidence, jangan mengarangnya.

## 7. Anti-Duplicate / Anti-Rebuild

Jangan membuat engine kedua, importer kedua, writer kedua, Resource Identity engine kedua, atau knowledge engine kedua. Gunakan capability canonical yang sudah ada.

**PROVEN → LOCK. Jangan bangun ulang.**

## 8. Owner Lock

Mockup yang disetujui Owner pada 8 September 2026 menjadi referensi visual untuk Detail AHSP. Refinement berikutnya harus bersifat minimal dan tidak boleh merusak bagian yang sudah PASS.

**SUPER SMART INSIDE, SIMPLE OUTSIDE.**

Soli Deo Gloria. Haleluya. Amin.
