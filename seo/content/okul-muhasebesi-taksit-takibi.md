---
title: "Okul Muhasebesinde Taksit ve Tahsilat Takibi"
description: "Taksit planı kurma, vadesi geçen ödemeleri otomatik işaretleme ve ücret türüne göre tahsilat kırılımı çıkarma."
date: "2026-08-13"
tags:
  - Muhasebe
  - Tahsilat
  - Okul yönetimi
keywords:
  - okul taksit takibi
  - tahsilat yönetimi
  - vadesi geçen ödeme
---

Eğitim kurumlarında mali takibin en zor tarafı tutar değil, **zamanlamadır**. Bir öğrencinin yıllık ücreti sekiz taksite bölündüğünde, 300 öğrencilik bir kurumda yıl içinde 2.400 vade noktası oluşur. Bu hacim elle tutulan bir defterle takip edilemez.

## Taksit planı nasıl kurulmalı?

Sağlıklı bir plan üç bilgiyi içerir: toplam tutar, taksit sayısı, ilk vade tarihi. Bölme işleminde en sık yapılan hata kuruş farkıdır. 10.000 TL'yi 3'e böldüğünüzde 3.333,33 × 3 = 9.999,99 çıkar. Doğru yaklaşım, farkı ilk taksite eklemektir:

```
1. taksit: 3.333,34
2. taksit: 3.333,33
3. taksit: 3.333,33
```

Böylece taksit toplamı her zaman sözleşme tutarına eşit kalır ve yıl sonunda mutabakat sorunu yaşanmaz.

## Ücret türlerini ayırın

Tüm tahsilatı tek kalemde toplamak, kırılım analizini imkânsız kılar. En az şu türleri ayırın:

- Okul / kurs ücreti
- Kıyafet
- Kitap ve kaynak
- Ek ders / etüt
- Yemek
- Servis

Bu ayrım hem "hangi kalemde tahsilat aksıyor" sorusunu yanıtlar hem de iade süreçlerini kolaylaştırır.

## Durumlar ve otomatik gecikme

Her taksit dört durumdan birinde olur: **ödendi**, **bekliyor**, **gecikti**, **iptal**. Kritik nokta şudur: vadesi geçmiş bir "bekliyor" kaydı otomatik olarak gecikmiş sayılmalıdır. Aksi halde yönetici her sabah listeyi elle güncellemek zorunda kalır ve gecikme raporu her zaman eksik olur.

Gecikmiş kayıtta gün sayısını da gösterin. 3 gün geciken ile 45 gün geciken aynı müdahaleyi gerektirmez.

## Yönetici için üç temel rapor

1. **Nakit akışı özeti:** bu ay tahsil edilen, bekleyen, geciken.
2. **Ücret türü kırılımı:** hangi kalemde ne kadar açık var.
3. **Öğrenci bazlı borç listesi:** en yüksek gecikmeden başlayarak sıralı.

Bu üç rapor, yönetim kurulu toplantısının mali gündemini karşılar.

## Kayıt defteriyle bağlantı

Muhasebe, öğrenci kayıt defterinden ayrı tutulduğunda isim tutarsızlıkları başlar. Ödeme planı doğrudan öğrenci kaydından açılabildiğinde sınıf bilgisi otomatik dolar, mükerrer kayıt oluşmaz ve veli girişinde doğru ödeme listesi görünür.

EduSetupPlus'ta taksit planı hem kayıt defteri satırından hem muhasebe formundan aynı akışla oluşturulur; vadesi geçen taksitler otomatik gecikmiş sayılır ve tahsilat kırılımı ücret türüne göre raporlanır.