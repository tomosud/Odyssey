# Light Type・Diffuse・Specular・Shadow調査経緯

このページはcanonical仕様ではなく、[[04_直接光・Shadow・Substrate BSDF評価]]から始まるLight Type資料へ清書した調査経緯を保持する。

## 発端

Directional／Point／Spot／Rect／Sky Lightについて、Diffuse、Specular、Shadowの実装差をLight Typeごとに把握するため調査した。

## 確定した区別

- Direct LightはLight Typeではなく直接到達成分で、Light Type名はDirectional Light。
- PointとSpotはlocal radial attenuationとcapsule source評価を共有し、Spotはcone attenuationを追加する。
- Rectは一方向の矩形面を積分し、Barn DoorとSource Textureを持つ。
- Directionalは距離減衰を持たず、Source Angleによる遠方円盤を扱う。
- ShadowはLight個別のvisibilityで、Pointは6方向、Spotはcone frustum、Directionalはclipmap／cascadeを使い得る。
- Sky Diffuseは低周波SH、Sky Specularはprefiltered cubemapで、Sky occlusionは通常の局所Shadow Mapではない。

## 条件付きとして残したもの

VSM、従来Shadow Map、Ray Tracing、MegaLightsでpass構成とsoft-shadow近似は変わる。Rectの矩形BSDF積分とshadow visibility精度を同一視しない。

## Source root

`C:\work\unreal\UnrealEngine-release`（UE 5.8）
