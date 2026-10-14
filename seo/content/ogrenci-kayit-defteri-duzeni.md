---
title: "Öğrenci Kayıt Defteri: Hangi Bilgiler Tutulmalı?"
description: "Kayıt defterini şişirmeden işlevsel tutmak için gereken alanlar, eşleştirme anahtarı ve veri temizliği kuralları."
date: "2026-08-12"
tags:
  - Kayıt defteri
  - Veri yönetimi
  - Okul yönetimi
keywords:
  - öğrenci kayıt defteri
  - veli iletişim bilgileri
  - öğrenci veri yönetimi
---

Kayıt defteri, kurumun tek doğruluk kaynağıdır. Analiz, muhasebe ve iletişim bu listeye bağlanır. Bu yüzden hem eksiksiz hem de gereksiz alanlarla şişirilmemiş olmalıdır.

## Zorunlu alanlar

Deneyim, şu alanların yeterli olduğunu gösteriyor:

- **Öğrenci adı soyadı** (eşleştirmenin temeli)
- **Sınıf / şube**
- **Kayıt durumu** (aktif, ayrıldı, dondurulmuş)
- **Veli adı** ve **veli telefonu**
- **Veli e-postası** (portal erişimi için)
- **Kayıt tarihi**

## Tercihe bağlı alanlar

Kuruma göre değerli olabilecek alanlar: doğum tarihi, ikinci veli iletişimi, servis kullanımı, sağlık notu, önceki okul. Bu alanları eklerken tek soruyu sorun: "Bu bilgiyi yıl içinde en az bir kez kullanacak mıyım?" Cevap hayırsa alanı eklemeyin; boş kalan alanlar listeyi okunmaz hâle getirir.

## Eşleştirme anahtarı: ad normalizasyonu

Deneme sonucu Excel dosyalarından gelen isimler ile elle girilen kayıtlar nadiren birebir aynıdır. Fark üretenler:

- Büyük/küçük harf farkı: "AYŞE YILMAZ" ↔ "Ayşe Yılmaz"
- Çift boşluk: "Ali  Veli"
- Türkçe karakter farkı: "Ilker" ↔ "İlker"
- Baştaki/sondaki boşluklar

Bu yüzden eşleştirme, ham metinle değil **normalleştirilmiş adla** yapılmalıdır: harfler küçültülür, fazla boşluklar tekleştirilir, Türkçe karakterler tutarlı biçime çevrilir. Böylece ek bir "öğrenci numarası" alanı doldurmaya gerek kalmadan analiz ile kayıt buluşur.

## Veri temizliği kuralları

Kayıt defteri zamanla bozulur. Üç kural bozulmayı yavaşlatır:

1. **Tek giriş noktası:** öğrenci yalnızca kayıt defterinden eklenir; muhasebe veya analiz ekranından yeni isim yaratılmaz.
2. **Durum kullanımı:** ayrılan öğrenci silinmez, durumu değiştirilir. Geçmiş tahsilat ve karne kayıtları korunur.
3. **Dönem başı kontrolü:** her dönem başında sınıf bilgileri toplu güncellenir.

## Veli erişimiyle ilişkisi

Veli portalı, veli e-postası üzerinden doğru öğrenciye bağlanır. Kayıt defterinde e-posta boşsa veli giriş yapsa bile hangi öğrencinin karnesini göreceği belirsiz kalır. Bu yüzden e-posta alanı, iletişim bilgisi değil **erişim anahtarı** olarak düşünülmelidir.

## Gizlilik

Kayıt defteri kişisel veri içerir. Üç ilke yeterlidir: yalnızca gerekli alanı topla, yalnızca yetkili kullanıcıya göster, kurumlar arası veri karışmasını teknik olarak engelle.

EduSetupPlus'ta öğrenci kayıtları kurum bazlı tutulur, analiz ve muhasebeyle normalleştirilmiş ad anahtarıyla eşleşir ve her satırdan karneye veya taksit planına tek tıkla geçilir.