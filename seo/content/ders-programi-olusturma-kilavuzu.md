---
title: "Okul Ders Programı Oluşturma Kılavuzu"
description: "Öğretmen müsaitliği, blok dersler, derslik kısıtları ve boş saat dengesiyle çakışmasız haftalık program kurmanın yöntemi."
date: "2026-08-14"
tags:
  - Ders programı
  - Okul yönetimi
  - Planlama
keywords:
  - ders programı hazırlama
  - çakışmasız ders programı
  - okul haftalık program
---

Ders programı, okulun günlük işleyişini belirleyen tek belgedir. Yanlış kurulmuş bir program yıl boyunca öğretmen memnuniyetsizliği, boş saatler ve telafi dersleri üretir. Doğru bir program ise fark edilmez: her şey yerinde olduğu için kimse programdan söz etmez.

## Önce kısıtları yazın

Programı denemeye başlamadan önce kısıtların tamamı listelenmelidir. Aksi halde her yeni kısıt, tamamlanmış programı baştan bozar.

- **Ders yükleri:** her sınıf için hangi ders haftada kaç saat.
- **Öğretmen müsaitliği:** gün bazında değil, gün × saat matrisinde. "Salı ilk iki ders yok" gibi kısıtlar yalnızca matrisle ifade edilebilir.
- **Derslik kısıtları:** laboratuvar, atölye, spor salonu gibi tek kullanımlı mekânlar.
- **Blok ders istekleri:** iki saati birleşik olması gereken dersler.
- **Sınıf müsaitliği:** kulüp saati, rehberlik saati, tören saatleri.

## Zaman ayarlarını üç katmanda kurun

Gerçek okullar tek tip bir zaman cetveline sığmaz. Üç katmanlı yapı esnekliği sağlar:

1. **Genel ayar:** ders süresi, teneffüs, başlangıç saati, günlük ders sayısı.
2. **Gün bazlı ayar:** cuma 5 ders, pazartesi tören nedeniyle geç başlangıç.
3. **Periyot bazlı ayar:** üçüncü ders 30 dakika, öğle arası 50 dakika.

Gün bazlı ayar tanımlanmadıysa genel ayar devralınmalıdır; aksi halde her günü tek tek doldurmak zorunda kalırsınız.

## Yerleştirme sırası önemlidir

Deneyimli program sorumluları en kısıtlı olanı en önce yerleştirir:

1. Tek derslik gerektiren dersler (laboratuvar, beden eğitimi)
2. Yarı zamanlı veya az müsait öğretmenler
3. Blok ders istekleri
4. Yoğun yüklü branşlar (matematik, Türkçe)
5. Kalan tek saatlik dersler

Bu sıra tersine çevrilirse, son yerleştirilen kısıtlı ders için hiç uygun saat kalmaz.

## Kalite ölçütleri

Program bittiğinde şu dört ölçütü kontrol edin:

- **Çakışma sayısı sıfır** olmalı (öğretmen, sınıf, derslik).
- **Öğretmen boş saatleri** dağınık değil, mümkün olduğunca uç saatlerde toplanmış olmalı.
- **Aynı ders aynı güne iki kez** yalnızca blok istendiyse konmalı.
- **Zor dersler günün son saatine** sürekli düşmemeli.

## Elle düzenleme ve sabitleme

Otomatik üretim iyi bir başlangıç verir, ancak yerel kararlar her zaman gerekir. Elle taşınan bir hücre otomatik olarak sabitlenmeli; aksi halde bir sonraki yeniden üretimde kullanıcının kararı silinir. Sabitlenen hücre sayısı arttıkça algoritmanın hareket alanı azalır, bu yüzden sabitlemeyi yalnızca gerçekten gerekli hücrelerde kullanın.

EduSetupPlus'ın ders programı modülü kısıtları gün × saat matrisiyle alır, çakışmasız program üretir, elle yapılan değişiklikleri sabitler ve programı yazdırılabilir/Excel'e aktarılabilir biçimde saklar.