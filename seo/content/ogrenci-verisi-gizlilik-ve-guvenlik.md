---
title: "Öğrenci Verisinde Gizlilik ve Güvenlik İlkeleri"
description: "Eğitim kurumlarında kişisel veriyi korumanın pratik kuralları: asgari veri, erişim sınırı ve saklama düzeni."
date: "2026-08-01"
tags:
  - Gizlilik
  - Güvenlik
  - Veri yönetimi
keywords:
  - öğrenci verisi güvenliği
  - kişisel veri koruma okul
  - veri gizliliği ilkeleri
---

Okullar, çocuklara ait hassas veriyi işleyen kurumlardır: kimlik bilgisi, iletişim, akademik performans, bazen sağlık notu. Bu verinin korunması teknik bir konu olduğu kadar kurumsal alışkanlık konusudur.

## İlke 1: Asgari veri

Toplanan her alan, korunması gereken bir yüktür. Bir bilgiyi "belki gerekir" diye toplamak, riski karşılıksız artırır. Kayıt defterine alan eklerken tek soruyu sorun: bu bilgiyi yıl içinde hangi işlem için kullanacağım?

## İlke 2: Erişim, ihtiyaca göre

Herkesin her şeyi görmesi kolay ama savunulamaz bir düzendir. Doğru yaklaşım işlem düzeyinde yetkidir:

- Öğretmen kendi sınıfının akademik verisini görür.
- Muhasebe personeli mali veriyi görür, karne detayına gerek duymaz.
- Veli yalnızca kendi çocuğunun verisini görür.
- Yönetici yetki verir ama kişisel şifreleri göremez.

## İlke 3: Şifreler geri okunamaz olmalı

Şifre düz metin olarak saklanmamalıdır. Doğru yöntem, kayıt başına rastgele tuz ile birlikte tek yönlü özet (PBKDF2, bcrypt, Argon2) kullanmaktır. Böylece veritabanı sızsa bile şifreler kullanılamaz. Yöneticinin kullanıcı şifresini görebildiği bir sistem, tanım gereği güvenli değildir.

## İlke 4: Oturumlar yönetilebilir olmalı

Erişim iptali yalnızca girişi engellemekle kalmamalı, açık oturumları da sonlandırmalıdır. Personel ayrıldığında hesabı askıya alındığı hâlde tabletinde açık kalan oturum, en sık gözden kaçan boşluktur.

## İlke 5: Kurumlar arası izolasyon

Çok kurumlu bir sistemde her kurum yalnızca kendi verisini görmelidir ve bu, arayüz filtresiyle değil veri erişim katmanında zorlanmalıdır. Kullanıcı kurum değiştirdiğinde tarayıcıdaki yerel önbellek de temizlenmelidir.

## İlke 6: Paylaşımda dikkat

En sık veri sızıntısı hacker saldırısıyla değil, günlük alışkanlıklarla olur:

- Tüm velilere açık alıcı listesiyle e-posta göndermek
- Sınıf grubuna isimli sonuç listesi atmak
- Ekran görüntüsünde başka öğrencilerin adlarının kalması
- Ortak kullanılan bilgisayarda oturumu açık bırakmak

Bu dördü için kısa bir kurum içi kural yazın; teknik önlemden daha etkili olur.

## İlke 7: Saklama ve silme

Verinin ne kadar tutulacağı belirlenmelidir. Ayrılan öğrencinin kaydı mali ve akademik geçmiş nedeniyle hemen silinmez ama durumu değiştirilir ve aktif listelerden çıkarılır. Gereksiz hâle gelen belgeler ise düzenli olarak temizlenir.

EduSetupPlus'ta şifreler tuzlanmış tek yönlü özetle saklanır, oturumlar yalnızca belirteç özetiyle tutulur, askıya alma tüm oturumları kapatır ve kurum verileri erişim katmanında izole edilir.