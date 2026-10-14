---
title: "Excel Deneme Sonuçlarını Analize Hazırlama"
description: "Yayın çıktılarındaki başlık, ad ve sütun sorunlarını gidererek dosyanın sorunsuz okunmasını sağlamak."
date: "2026-08-09"
tags:
  - Excel
  - Veri hazırlığı
  - Deneme analizi
keywords:
  - excel deneme sonucu
  - veri temizleme
  - sonuç dosyası formatı
---

Deneme analiz sistemlerinde yaşanan sorunların büyük bölümü analiz mantığından değil, girdi dosyasının biçiminden kaynaklanır. Birkaç basit kural, dosyanın ilk denemede okunmasını sağlar.

## Bir dosya, bir tablo

En sık hata, tek sayfaya birden fazla tablo yerleştirmektir: üstte sınıf özeti, altta öğrenci listesi, yanda grafik. Ayrıştırıcı hangi tablonun asıl veri olduğunu belirlemek zorunda kalır. Her sayfada tek bir tablo bulunsun; özetler ayrı sayfaya alınsın.

## Başlık satırı tek olmalı

Birleştirilmiş hücrelerle kurulan iki-üç katlı başlıklar (üstte "MATEMATİK", altta "D / Y / N") insan için okunur, program için belirsizdir. Mümkünse başlıkları tek satırda birleştirin: `Matematik Doğru`, `Matematik Yanlış`, `Matematik Net`.

İki katlı başlık zorunluysa, alt başlıkların üst başlıkla aynı sütun aralığında hizalı durmasına dikkat edin.

## Öğrenci adı yazımı

Aynı öğrenci iki dosyada farklı yazıldığında birleşme başarısız olur. Şu kurallara uyun:

- Ad ve soyadı aynı hücrede, aralarında tek boşluk.
- Baştaki/sondaki boşlukları temizleyin.
- Tümü büyük harf veya normal yazım — ama iki dosyada aynı şekilde.
- Unvan, sınıf veya numara adın içine yazılmasın; ayrı sütunda dursun.

## Sayısal alanlar metin olmasın

Excel'de sayı gibi görünen bir hücre metin biçiminde olabilir. Belirtisi: hücre sola yaslıdır ve köşesinde yeşil üçgen bulunur. Bu durumda net ve oran hesapları hatalı çıkar. Sütunu seçip "Sayıya Dönüştür" işlemi tek adımda çözer.

Ondalık ayırıcı da önemlidir: `16,33` ile `16.33` farklı sistemlerde farklı yorumlanır. Dosya boyunca tek bir biçim kullanın.

## Boş satır ve alt toplamlar

Öğrenci listesinin arasına konan boş satırlar, ortalama satırları veya "TOPLAM" satırları öğrenci gibi okunabilir. Bunları listenin içinden çıkarıp en alta veya ayrı bir sayfaya taşıyın.

## Konu tablosunda toplam tutarlılığı

Konu bazlı tabloda her satır için şu eşitlik sağlanmalıdır:

```
doğru + yanlış + boş = konunun soru sayısı
```

Eşitlik bozulduğunda başarı oranı yanlış hesaplanır. Dosyayı göndermeden önce bu kontrolü bir formülle yapmak dakikalar alır, saatlerce hata aramaktan kurtarır.

## Şablonla çalışın

En güvenli yol, sistemin beklediği başlıkları içeren hazır bir şablonu doldurmaktır. Şablon, sütun adlarını ve sıralamayı garanti eder; siz yalnızca satırları değiştirirsiniz.

EduSetupPlus'ta hem ders netleri hem konu analizi için örnek Excel şablonları indirilebilir; her şablonda doldurma kurallarını açıklayan ayrı bir "Nasıl Kullanılır" sayfası bulunur.