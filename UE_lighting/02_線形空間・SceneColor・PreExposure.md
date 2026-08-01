# 線形空間・SceneColor・PreExposure

## ライティング空間

通常のdesktop renderingでは、textureのsRGB encodingをsample時に線形化し、Light、BRDF、GI、Emissiveをscene-referred linear RGBで計算・加算する。Working Color Spaceはprimariesの定義であり、線形／非線形の区別とは別である。

## 計算精度と保存精度

shader arithmeticの中間値とrender targetの保存形式は同じ意味ではない。GPU演算はshader／platform／compilerによりFP32またはhalf系を使い得るが、既定SceneColorは`PF_FloatRGBA`、すなわちRGBA16Fで量子化される。

```text
Material / Lighting arithmetic
  → linear lighting contribution
  → × View.PreExposure
  → FP16へ丸めてSceneColorへwrite / blend
```

SceneColorへ保存する直前まで「RGBA16Fと無関係な無限精度」であるわけではない。一方、SceneColor formatがすべてのshader中間演算精度を決めるわけでもない。

## PreExposure

SceneColorの基本関係は次である。

```text
SceneColorStored = LinearSceneLighting × View.PreExposure
```

PreExposureは完成したSceneColorへ後から掛けるpassではない。Base Pass、Deferred Light、Emissive等がSceneColorへ書く直前、または加算直前に同じ尺度へ揃える。

目的はFP16でoverflowと低輝度側の精度低下を抑えること。線形な共通倍率なので相対的な光量関係は維持される。

## 100万のEmissive例

```text
Emissive                 = 1,000,000
View.PreExposure         = 0.001
SceneColorへの保存値    = 1,000
```

保存値がFP16最大有限値付近の約65504を超えれば飽和・非有限値対策の対象になり得る。PreExposureは範囲を大幅に安定させるが、急な発光が現れた最初のframeを含むあらゆるoverflowを保証して防ぐものではない。

## 値の決定

通常は直近のEye Adaptation exposureに近い値をViewStateから使う。override、manual exposure、camera cut、ViewStateなし等で分岐する。Auto Exposureの現在frameの測光値と、SceneColorを書いたPreExposureが完全一致しなくても、後段で`OneOverPreExposure × GlobalExposure`により補正される。

関連: [[08_Exposure・Post Process・Tonemap]]

