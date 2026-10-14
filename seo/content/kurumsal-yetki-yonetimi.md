---
title: "Okul Yazılımında Yetki Yönetimi Nasıl Kurulur?"
description: "Rol tabanlı yaklaşımın sınırları, ince yetki modeli ve kurum içinde güvenli erişim düzeni."
date: "2026-08-11"
tags:
  - Yetki yönetimi
  - Güvenlik
  - Okul yönetimi
keywords:
  - rol tabanlı yetki
  - okul yazılımı erişim kontrolü
  - kullanıcı yetkileri
---

Okul yazılımlarında en sık görülen erişim hatası şudur: bir kişiye tek bir ek işlem yaptırmak için rolü yükseltilir ve o kişi bir anda tüm mali verilere erişir. Roller kolay kurulur ama gerçek hayatın ara durumlarını taşımaz.

## Rol yeterli değil, neden?

Gerçek kurumlarda şu talepler sürekli çıkar:

- Bir öğretmen deneme sonucu yüklesin ama muhasebeyi görmesin.
- Bir sekreter tahsilat girsin ama gider kalemlerini değiştirmesin.
- Bir müdür yardımcısı ders programını düzenlesin ama kullanıcı yetkisi tanımlamasın.

Bu üçü, klasik "öğretmen / yönetici" ikilisine sığmaz. Çözüm, rolü tamamen kaldırmak değil; rolü **varsayılan yetki paketi** olarak kullanıp üzerine tek tek yetki eklemektir.

## İnce yetki modeli

Yetkiler işlem düzeyinde tanımlanmalıdır. Örnek bir set:

- Okul geneli analiz görüntüleme
- Deneme sonucu yükleme
- Hedef / ödev / rehberlik kaydı
- Ders programı düzenleme
- Muhasebe görüntüleme
- Muhasebe yönetimi
- Kullanıcı ve yetki yönetimi

Kullanıcının etkin yetkisi = rolün varsayılanları ∪ yöneticinin verdiği ek yetkiler. Rolle gelen yetkiler arayüzde kilitli gösterilmeli; böylece yanlışlıkla temel bir yetki kaldırılmaz.

## Kurum izolasyonu

Çok kurumlu bir sistemde en kritik kural, yetkiden önce gelir: **her kurum yalnızca kendi verisini görür.** Bu, arayüzde filtre uygulamakla değil, veri erişim katmanında kurum kapsamı zorlanarak sağlanmalıdır. Kullanıcı kurum değiştirdiğinde yerel önbellek de temizlenmelidir; aksi halde önceki kurumun verisi ekranda kalabilir.

## Erişim yaşam döngüsü

Yetki vermek kolaydır, geri almak unutulur. Sağlıklı bir döngü şu adımlardan oluşur:

1. **Davet:** yönetici e-posta ve yetkileri tanımlar, tek kullanımlık erişim kodu üretir.
2. **İlk giriş:** kullanıcı kendi şifresini belirler; yönetici şifreyi görmez.
3. **Kullanım:** yetkiler gerektiğinde güncellenir, değişiklik anında etkili olur.
4. **Askıya alma:** ayrılan personelin erişimi kapatılır ve tüm eski oturumları sonlanır.

Dördüncü adım en çok atlanan adımdır. Askıya alma işlemi yalnızca girişi engellemekle kalmamalı, açık oturumları da kapatmalıdır.

## Denetim izi

Kim, kime, hangi yetkiyi, ne zaman verdi? Bu bilgi tutulmadığında sorumluluk belirsizleşir. Yetki değişikliklerine kısa bir yönetici notu eklenmesi, altı ay sonra "bu yetki neden verilmiş" sorusunu yanıtlar.

EduSetupPlus'ta erişim ince yetki tabanlıdır: rol varsayılanları kilitli gösterilir, ek yetkiler tek tek işaretlenir, kurum izolasyonu veri katmanında zorlanır ve askıya alma tüm oturumları kapatır.