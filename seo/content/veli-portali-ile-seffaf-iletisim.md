---
title: "Veli Portalı ile Şeffaf İletişim Kurmak"
description: "Velinin kendi çocuğunun karnesini, ödemelerini ve programını görebildiği bir portalın kurum içi etkileri."
date: "2026-08-06"
tags:
  - Veli portalı
  - İletişim
  - Okul yönetimi
keywords:
  - veli portalı
  - veli bilgilendirme sistemi
  - okul iletişimi
---

Velilerin okula en sık yönelttiği talepler aslında birbirine benzer: çocuğumun son deneme sonucu ne, hangi konularda eksik, kalan ödemem ne kadar, bu haftanın programı nedir. Bu dört bilginin telefonla sorulması, hem sekreterliği hem öğretmeni gün boyu meşgul eder.

## Portalın çözdüğü asıl sorun

Bir veli portalı, bilgi yaratmaz; var olan bilginin **doğru kişiye, doğru kapsamda ve anında** ulaşmasını sağlar. Kazanç iki taraflıdır:

- Veli beklemeden erişir, ikinci elden yanlış bilgi almaz.
- Kurum, aynı soruyu günde on kez yanıtlamaktan kurtulur.

## Kapsam sınırı en kritik tasarım kararı

Portalın en önemli özelliği, gösterdiği değil **göstermediği** bilgidir. Veli yalnızca kendi çocuğunun verisini görmelidir: başka öğrencilerin netleri, sıralamaları veya ödeme durumları asla görünmemelidir.

Bu, arayüzde filtre uygulamakla değil, erişim katmanında zorlanmalıdır. Veli hesabı kayıt defterindeki e-posta üzerinden ilgili öğrenciye bağlanır; eşleşme yoksa hiçbir veri gösterilmez.

## Neler paylaşılmalı?

Deneyime göre en faydalı dört bölüm:

1. **Karne:** ders netleri, eksik konular, öncelikli çalışma planı.
2. **Gidişat:** denemeler arası net ve puan eğrisi, hedefe uzaklık.
3. **Ödemeler:** taksit listesi, ödenen/bekleyen/geciken durumu.
4. **Ders programı:** haftalık program, sınav ve etüt takvimi.

## Neler paylaşılmamalı?

- Sınıf içi sıralama listeleri (isimli)
- Öğretmenlerin kendi aralarındaki değerlendirme notları
- Disiplin süreci devam eden kayıtlar
- Diğer velilerin iletişim bilgileri

## Dil ve sunum

Veli, öğretmen değildir. Portalda "kazanım bazlı standart sapma" gibi ifadeler yerine anlaşılır etiketler kullanılmalıdır: kritik, geliştirilmeli, iyi, güçlü. Karnenin tek sayfada yazdırılabilir olması da önemlidir; birçok veli belgeyi kâğıt üzerinde okumayı tercih eder.

## Beklenti yönetimi

Portal açıldığında velinin ilk beklentisi "her gün güncelleme" olur. Bu yüzden verinin ne zaman güncellendiğini açıkça belirtin: "son yüklenen deneme: 20 Ağustos". Güncellenme sıklığı bilinen bir sistem, sürekli güncelleniyor sanılan sistemden daha çok güven verir.

EduSetupPlus'ta veli girişi kayıt defterindeki e-posta ile çözülür; veli yalnızca kendi öğrencisinin karnesini, gidişatını, ödeme planını ve ders programını görür.