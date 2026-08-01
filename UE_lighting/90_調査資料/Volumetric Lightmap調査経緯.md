# Volumetric Lightmap調査経緯

このページはcanonical仕様ではなく、[[05A_Volumetric Lightmap・Surface Lightmap]]へ清書した調査経緯を保持する。

## 発端となった質問

- VLMには何が格納され、receiverがどう利用するか。
- BuiltData assetへどう保存されるか。
- Surface LightmapのActor／LOD固有紐づきと何が違うか。
- Actor変更時の`Lighting needs to be rebuilt`とVLMに関係があるか。
- Assetの一部へくっきりした暗部が現れる現象をVLMで説明できるか。

## 確定した区別

- Surface LightmapはComponent／LODの`MapBuildDataId`で専用Build Dataを参照する。
- VLMはLevel単位で保持され、runtime receiverはWorld Positionで参照する。
- Actorへのruntime直接参照がなくても、Actor geometryはVLM生成入力である。
- 個別Componentのcache無効化とLevel単位VLMの即時破棄は同一処理ではない。
- VLMは低周波incident radiance SHであり、specular反射像ではない。

## 未確定

経験された暗部の原因はcapture、該当map、Mobility、Material、Reflection構成がないため確定していない。canonicalページの診断手順でVLM、Surface Lightmap、Reflection系を分離する。

## Source root

`C:\work\unreal\UnrealEngine-release`（UE 5.8）
