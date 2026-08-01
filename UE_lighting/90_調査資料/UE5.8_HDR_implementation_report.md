# UE 5.8 HDR実装調査レポート

## 1. 調査範囲と前提

- 調査対象: `C:\work\unreal\UnrealEngine-release`
- エンジン表記: `Engine/Build/Build.version` は `5.8.0`、`BranchName` は `UE5`
- 比較対象メモ: `moto_chat.txt`
- 調査方法: 上記ソースツリーのC++、シェーダー、設定コード、Lyraサンプル、同梱ThirdParty情報を静的に確認した。
- 本レポートは、このソーススナップショットから確認できる実装を記述する。実機での表示結果、各GPUドライバーの挙動、未取得の公式リリースノートにしかない変更理由は検証対象外である。
- このソースツリーには利用可能なGit履歴およびUE 5.7の比較ソースがない。そのため「5.8で追加された」「5.7の300 nitから変更された」といった版間差分は、5.8側に移行コード等の直接証拠がある場合を除き断定しない。

## 2. 結論

このUE 5.8ソースでは、ACES 2.0 Rendering Transformは実装済みであり、SDRだけでなくHDRのPQ/ST 2084およびscRGB出力経路にも組み込まれている。`r.HDR.Aces.Version`のC++初期値は`2`で、シェーダーは値が`2`以上の場合にACES 2.0経路を選ぶ。

したがって、元メモの「公式説明ではSDR対応のみ確認でき、HDRはACES 2.0へ全面置換されたとまでは確認できない」という留保は、今回指定されたソースの実装状況には合わない。少なくともコード上はHDR出力にもACES 2.0分岐がある。

ただし、次の点は区別が必要である。

- HDR出力自体は既定で無効である。プロジェクト側の`r.AllowHDR`、実行時の`r.HDR.EnableHDROutput`、RHIとディスプレイの対応が必要になる。
- ACES 2.0の選択とWorking Color Spaceの選択は別である。ACES 2.0を選ぶことがWorking Color SpaceをACEScgへ変更することを意味しない。
- `r.HDR.Aces.Version`の初期値は`2`だが、同じCVarのヘルプ文字列には`1: ACES 1.3 (default)`と書かれている。実値と説明が矛盾しており、ソースだけからその意図は分からない。実装上の初期値は`2`である。
- 現在の既定Paper WhiteとUI輝度はともに203 nitである。ただし、UE 5.7側の根拠がないため「5.8で300 nitから203 nitへ変更された」という差分までは本調査では確認できない。

## 3. 元メモの主張の判定

| 元メモの主張 | 判定 | ソースから確認できた内容 |
|---|---|---|
| UE 5.8はACES 2.0対応を追加している | 確認 | ACES 2.0用テーブル生成、シェーダー分岐、CVarが存在する。 |
| 明確に確認できるのはSDR対応で、HDRへの適用は不明 | 不正確 | PQ/ST 2084とscRGBのHDR出力分岐内に`USE_ACES_2`経路が実装されている。 |
| 標準レンダリングが無条件にACES 2.0へ全面置換されたとはいえない | 条件付きで正しい | ACES 1.3経路は残存しCVarで選択可能。HDR出力も別途有効化が必要。ただしCVarの実装初期値は`2`。 |
| ACES 2.0とWorking Color Spaceは別設定 | 確認 | ACES変換にはWorking Color SpaceからAP0への行列が渡されており、ACESバージョン選択と色空間定義は独立している。 |
| RHIからディスプレイ情報を取得してトーンマッピングに使う | 確認（Windows/D3D12） | DXGIからHDR対応、最小・最大・全画面最大輝度、色域を取得し、ウィンドウと最も重なる表示へ割り当てる。今回確認できた具体実装はWindows/D3D12。 |
| Paper WhiteをGameUserSettingsから設定できる | 確認 | getter/setterと保存値があり、Engineが`r.HDR.PaperWhite`へ反映する。 |
| HDR UI基準は203 nit | 現状値として確認 | Paper White、UI luminance、Slate合成の既定が203 nit。 |
| 300 nitから203 nitへ変更された | 確認不能 | 5.7比較ソースまたは変更履歴がないため、版間変更は断定できない。 |
| UI合成方法も変更された | 現状実装のみ確認 | Gamma 2.4、Gamma空間blend、改善用shader passが既定。旧版との差分は確認不能。 |
| LyraにHDR設定例がある | 確認 | HDR有効化、キャリブレーション、Paper White設定が登録されている。 |
| OpenColorIOは2.5.1 | 確認 | 同梱ABIヘッダーとビルドスクリプトが2.5.1を指定する。 |
| OCIOの組み込みACES 2.0変換が利用できる | 確認 | 新規設定は`ocio://default`を使い、旧AssetについてはACES 1.3固定設定へ退避する移行処理がある。利用可能な具体的変換一覧はOCIOライブラリ側の組み込み設定に依存する。 |

## 4. ACES 2.0の実装

### 4.1 バージョン選択

`r.HDR.Aces.Version`は次の値を受け付ける。

- `1`: ACES 1.3
- `2`: ACES 2.0

C++初期値は`2`である。シェーダーパーミュテーションは値が`1`より大きい場合に`USE_ACES_2`を有効にする。

注意点として、CVar説明文はACES 1.3を`default`と記述している一方、直前の初期値は`2`である。この矛盾について、どちらが製品仕様として意図された文言かは分からない。コンソール変数がini、Device Profile、起動引数等で上書きされなければ、コード初期値`2`が使われる。

根拠:

- `Engine/Source/Runtime/RenderCore/Private/RenderCore.cpp:399-405`
- `Engine/Source/Runtime/Renderer/Private/PostProcess/PostProcessCombineLUTs.cpp:813-822`
- `Engine/Source/Runtime/Renderer/Private/PostProcess/ACESUtils.cpp:875-905`

### 4.2 SDR経路

ACES 2.0のOutput Transformはピーク輝度、limiting color space、Working Color SpaceからAP0への変換、および3種類の参照テーブルを受け取る。SDR用リソースはピーク100 nitで生成される。最終エンコードは出力最大輝度が100 nit基準以下ならsRGBへ進む。

根拠:

- `Engine/Source/Runtime/Renderer/Private/PostProcess/ACESUtils.cpp:915-919`
- `Engine/Shaders/Private/PostProcessCombineLUTsInner.usf:59-83,107-137`

### 4.3 HDR経路

HDRにもACES 2.0が明示的に実装されている。

- PQ/ST 2084: ACES 2.0 Output Transformを適用後、`LinearToST2084`で符号化する。
- scRGB: ACES 2.0 Output Transformを適用後、scRGBの基準白で正規化する。
- どちらも`OutputMaxLuminance`をACES 2.0 Output Transformへ渡す。

このため「ACES 2.0対応はSDRのみ」という解釈は、このソースには当てはまらない。

根拠:

- `Engine/Shaders/Private/PostProcessDeviceEncodingOnly.usf:107-157`
- `Engine/Source/Runtime/Renderer/Private/PostProcess/PostProcessDeviceEncodingOnly.cpp:242-263`

### 4.4 ACES 1.3との共存

ACES 1.3用コードは削除されていない。`USE_ACES_2`が無効なら従来の`FACESTonemapParams`を用いる経路へ入る。よって「コードベース全体からACES 1.xが完全に置換された」わけではない。

また、古いOpenColorIO Configuration Assetは見た目の破壊的変更を避けるため、ロード時にACES 1.3固定のbuilt-in configへ移される。既存OCIO Assetが自動的にACES 2.0へ移行するとは限らない。

根拠:

- `Engine/Shaders/Private/PostProcessDeviceEncodingOnly.usf:125-129,153-157`
- `Engine/Plugins/Compositing/OpenColorIO/Source/OpenColorIO/Private/OpenColorIOConfiguration.cpp:534-550`

## 5. HDR出力の有効化と出力形式

HDR出力には少なくとも次の条件がある。

1. `r.AllowHDR=1`によりプロジェクト／プラットフォームでHDRを許可する。
2. `r.HDR.EnableHDROutput=1`により実行時HDRを有効にする。
3. RHIがHDR出力をサポートする。
4. 対象ディスプレイがHDR対応として検出される。

両CVarのコード既定値は`0`であり、HDR出力は既定無効である。

定義済み出力デバイスは次のとおり。

| 値 | 出力形式 |
|---:|---|
| 0 | sRGB (LDR) |
| 1 | Rec.709 (LDR) |
| 2 | Explicit gamma mapping (LDR) |
| 3 | ACES 1000 nit ST 2084 / PQ (HDR) |
| 4 | ACES 2000 nit ST 2084 / PQ (HDR) |
| 5 | ACES 1000 nit scRGB (HDR) |
| 6 | ACES 2000 nit scRGB (HDR) |
| 7 | Linear EXR (HDR) |
| 8 | Linear final color、tone curveなし (HDR) |
| 9 | Linear final color、tone curveあり |

出力色域の選択肢としてRec.709/sRGB D65、DCI-P3 D65、Rec.2020 D65、ACES D60、ACEScg D60が定義されている。これは出力色域のenum/CVarであり、プロジェクトのWorking Color Spaceそのものではない。

根拠:

- `Engine/Source/Runtime/RenderCore/Private/RenderCore.cpp:320-356,408-435`

## 6. ディスプレイ情報とトーンマッピング

### 6.1 共通経路

HDR有効時、RenderCoreは`RHIGetDisplaysInformation`で表示一覧を取得し、ウィンドウ矩形との重なり面積が最大の表示を選ぶ。その表示から次を取得する。

- HDR対応可否
- 最小輝度
- 最大輝度
- 全画面最大輝度
- limiting color space
- プラットフォーム対応時のPaper White

一覧を取得できない場合はCVar由来の既定メタデータへフォールバックする。

根拠:

- `Engine/Source/Runtime/RenderCore/Private/RenderCore.cpp:583-648`
- `Engine/Source/Runtime/RHI/Public/DynamicRHI.h:658,1336-1338`

### 6.2 Windows/D3D12

Windows/D3D12実装はDXGI `IDXGIOutput6::GetDesc1`から情報を得る。HDR対応判定はDXGI色空間が`RGB_FULL_G2084_NONE_P2020`かどうかで行う。DXGIが最大輝度を0として返した場合、HDR表示は1000 nit、SDR表示は100 nitへフォールバックする。全画面最大輝度のフォールバックはHDR 600 nit、SDR 100 nitである。

今回の検索で具体的な`RHIGetDisplaysInformation` overrideを確認できたのはWindows/D3D12である。VulkanやApple系を含む全プラットフォームで同等の取得が実装済みかは、この調査結果からは分からない。

根拠:

- `Engine/Source/Runtime/D3D12RHI/Private/Windows/WindowsD3D12Device.cpp:570-629`
- `Engine/Source/Runtime/D3D12RHI/Private/Windows/WindowsD3D12Viewport.cpp:569-572`

### 6.3 ユーザー較正値との関係

`UGameUserSettings`は最大表示輝度と「ユーザー較正を使うか」を保持する。ユーザー較正が有効ならEngineは`r.HDR.Display.OverrideOSMaxLuminance`を有効にし、OS由来の最大輝度よりGameUserSettingsの値を優先する。無効ならトーンマッパはディスプレイメタデータ側の最大輝度を用いる。

根拠:

- `Engine/Source/Runtime/Engine/Classes/GameFramework/GameUserSettings.h:387-427`
- `Engine/Source/Runtime/Engine/Private/GameUserSettings.cpp:1145-1244`
- `Engine/Source/Runtime/Engine/Private/UnrealEngine.cpp:1100-1118`
- `Engine/Source/Runtime/Renderer/Private/PostProcess/PostProcessTonemap.cpp:287-290`

## 7. Paper WhiteとHDR UI

### 7.1 Paper White

Paper Whiteの既定値は203 nitで、コメントとCVar説明はBT.2408のHDR Reference Whiteとしている。プラットフォームがPaper Whiteを提供する場合、既定モードではプラットフォーム値を使い、それ以外は`r.HDR.PaperWhite`を使う。

`UGameUserSettings`には`SetHDRPaperWhiteNits`／`GetHDRPaperWhiteNits`があり、Engineがその値を`r.HDR.PaperWhite`へ反映する。元メモの「GameUserSettingsから設定可能」は正しい。

根拠:

- `Engine/Source/Runtime/RenderCore/Private/RenderCore.cpp:417-430,633-642`
- `Engine/Source/Runtime/Engine/Private/GameUserSettings.cpp:330-334,1217-1224`
- `Engine/Source/Runtime/Engine/Private/UnrealEngine.cpp:1105-1118`

### 7.2 UI輝度と合成

UI輝度の既定値も203 nitである。既定の`r.HDR.UI.Luminance.Mode=0`では独立したUI値ではなくPaper Whiteを使う。モードを`1`にすると`r.HDR.UI.Luminance`を使う。GameUserSettingsはUI輝度と独立モードを保持し、Engineが両CVarへ反映する。

現在のSlate HDR UI合成の既定は次のとおり。

- UI EOTF: Gamma
- EOTF gamma: 2.4（コードコメントではBT.1886／BT.2408に合わせる）
- blend space: Gamma
- blend gamma: 2.4
- composite mode: 改善用shader pass (`1`)

元メモの「SDRに近い見た目になるようデフォルト合成方法が調整された」がどの版との差分を指すかは、現在のソースだけでは分からない。上記の現行値までは確認できる。

根拠:

- `Engine/Source/Runtime/SlateRHIRenderer/Private/SlateRHIRenderer.cpp:81-138,1095-1112`
- `Engine/Source/Runtime/SlateRHIRenderer/Private/SlatePostProcessor.cpp:150-170`
- `Engine/Source/Runtime/Engine/Private/GameUserSettings.cpp:330-334,1227-1244`

## 8. Lyraの実装例

Lyraには次のHDR設定例がある。

- HDR表示の有効／無効
- HDR較正を使うかの設定
- 最大表示輝度の較正画面
- HDR Paper White設定

Paper White設定の説明文には203 nitが暗い環境に適する旨が書かれている。最大輝度較正画面はPQ空間で入力値を増減し、最終的に`SetMaximumHDRDisplayNits`へ反映する。

根拠:

- `Samples/Games/Lyra/Source/LyraGame/Settings/LyraGameSettingRegistry_Video.cpp:354-424`
- `Samples/Games/Lyra/Source/LyraGame/Settings/Screens/LyraHDRCalibrationEditor.cpp:42-49,90-122`
- `Samples/Games/Lyra/Source/LyraGame/Settings/CustomSettings/LyraSettingAction_HDRCalibrationEditor.cpp:20-21`

## 9. OpenColorIO 2.5.1とACES 2.0

同梱OpenColorIOは2.5.1である。これはABIヘッダー、Windows/Linux/macOS向けビルドスクリプト、ThirdParty noticeで一致する。

新規`UOpenColorIOConfiguration`はエディタ上で`ocio://default`をロードする。古いAssetを読み込む際、カスタムバージョンが`OpenColorIOv251`より古く、設定が`default`または`latest`を指していた場合は、ACES 2.0による破壊的な見た目変更を避けるためACES 1.3／OCIO 2.4固定configへ差し替える。

ここから確認できることは、OCIO 2.5.1のbuilt-in default/latest configがACES 2.0変換を含むことを前提にUE側が対応し、既存Assetには互換措置を設けている、という点である。一方、UEのネイティブトーンマッパとOpenColorIO Configuration Assetは別経路であり、「OCIOを更新したからUEの通常ビューポートがACES 2.0になる」という因果関係ではない。

根拠:

- `Engine/Source/ThirdParty/OpenColorIO/Deploy/OpenColorIO/include/OpenColorIO/OpenColorABI.h:10-27`
- `Engine/Source/ThirdParty/OpenColorIO/BuildForWindows.bat:10-11`
- `Engine/Plugins/Compositing/OpenColorIO/Source/OpenColorIO/Private/OpenColorIOConfiguration.cpp:513-550`

## 10. 主要CVar

| CVar | コード既定値 | 役割・注意点 |
|---|---:|---|
| `r.AllowHDR` | `0` | HDR対応swap chainをプロジェクト／プラットフォームで許可する。read-only。 |
| `r.HDR.EnableHDROutput` | `0` | 実行時HDR出力を有効にする。 |
| `r.HDR.Display.OutputDevice` | `0` | 出力transfer function／形式。コードから設定される経路がある。 |
| `r.HDR.Display.ColorGamut` | `0` | 出力色域。コードから設定される経路がある。 |
| `r.HDR.Display.MinLuminanceLog10` | `-4.0` | 表示最小輝度のlog10値。 |
| `r.HDR.Display.MidLuminance` | `15.0` | 18% grayの出力nit値。 |
| `r.HDR.Display.MaxLuminance` | `0` | 有効時の最大表示輝度。GameUserSettingsとの連絡にも使われる。 |
| `r.HDR.Display.OverrideOSMaxLuminance` | `false` | OS／RHI取得値よりユーザー較正値を優先する。 |
| `r.HDR.Aces.Version` | `2` | `1`=ACES 1.3、`2`=ACES 2.0。ヘルプ文のdefault表記と矛盾。 |
| `r.HDR.Aces.SceneColorMultiplier` | `1.5` | ACESへ渡すscene color倍率。 |
| `r.HDR.Aces.GamutCompression` | `0.0` | ACES 1.x経路のgamut compression係数。 |
| `r.HDR.PaperWhite` | `203` | HDR Reference White。 |
| `r.HDR.PaperWhite.Mode` | `0` | プラットフォーム値があれば利用し、なければCVar値を利用。 |
| `r.HDR.UI.Level` | `1.0` | UI輝度倍率。 |
| `r.HDR.UI.Luminance` | `203` | 独立UI輝度。Modeが1の場合に利用。 |
| `r.HDR.UI.Luminance.Mode` | `0` | `0`=Paper White、`1`=独立UI輝度。 |
| `r.HDR.UI.CompositeEOTF` | `0` | `0`=Gamma、`1`=sRGB。 |
| `r.HDR.UI.CompositeBlend` | `0` | `0`=Gamma、`1`=Linear。 |
| `r.HDR.UI.CompositeMode` | `1` | `1`=HDR blend改善用shader pass。 |

## 11. ソースだけでは分からないこと

- UE 5.7以前と比較して、どの行が5.8で追加／変更されたか。
- UIの基準値が実際に300 nitから203 nitへ変わった時期。
- `r.HDR.Aces.Version`のヘルプ文と初期値の矛盾が意図的か、単なる更新漏れか。
- 各プラットフォーム、各RHI、各GPUドライバーでの最終的なHDR対応状況。今回、表示メタデータ取得の具体実装を確認できたのはWindows/D3D12。
- 実機ディスプレイ上での画質、色相、ハイライト、UIの見え方。コード構造から「改善される」とは断定できず、測定または目視比較が必要。
- ACES 2.0の規格上の一般的な画質改善内容。今回の一次資料はUEソースであり、AcademyのACES仕様書自体は調査対象に含めていない。

## 12. 元メモを置き換える短い要約

UE 5.8の指定ソースにはACES 2.0 Rendering Transformが実装されており、SDR 100 nitだけでなくHDRのPQ/ST 2084とscRGB経路でも使用される。`r.HDR.Aces.Version`の実装初期値は`2`だが、ACES 1.3経路も互換用に残る。HDR出力は別途許可・有効化が必要で、Windows/D3D12ではDXGIから対象表示のHDR対応、輝度、色域を取得してトーンマッピングへ渡す。Paper WhiteとHDR UI輝度の既定値は203 nitで、GameUserSettingsから最大表示輝度、Paper White、UI輝度を設定できる。Lyraにはその設定・較正画面の実装例がある。同梱OpenColorIOは2.5.1でACES 2.0対応を前提とする一方、既存OCIO Assetは見た目を維持するためACES 1.3固定configへ退避する。5.7との比較資料がないため、300 nitから203 nitへの変更時期などの版間差分は確認不能である。

## 13. Qiita PDFのソース照合と利用者向け補足

対象資料: `UE5.8のTonemapとACES2.0 #UnrealEngine - Qiita.pdf`（2026-07-31、全8ページ）

### 13.1 総合評価

PDFはUE 5.8でHDRを設定・調整する利用者向け資料として概ね正しい。特に、Filmic／Standard ACESの選択、Standard ACESではFilmパラメータが効かないこと、ACES 2.0でPaper Whiteと最大表示輝度が重要になること、OS値とユーザー較正値の切り替え、UI輝度設定についてはソースと一致する。

ただし、次は補足または修正が必要である。

- 「FilmicはSDR向け、Standard ACESはHDR向け」は単純化しすぎである。両方式ともSDR/HDRで動作する。Filmic HDRにはACESを使うAutomatic HDR経路があり、Standard ACESのSDR経路もある。
- Paper Whiteは「低～中輝度だけを調整する値」ではない。ACES 2.0実装では`PaperWhite / 203`がシーン全体の入力倍率に含まれる。
- 最大表示輝度は単純な画面輝度倍率ではなく、ACES Output Transformへ渡す表示ピーク条件である。
- UE 5.7でACES 1.3が既定だったという版間差分は、今回の5.8ソースだけでは確認できない。
- OS／デバイス値へ任せれば常に適切になるとは保証できない。Windows/D3D12には取得実装とfallbackがあるが、全RHIの同等性と実機結果は未確認である。

### 13.2 PDFの主張別判定

| PDFの記述 | 判定 | ソースから分かる補足・修正 |
|---|---|---|
| `r.AllowHDR=1`をiniへ設定し、`r.HDR.EnableHDROutput 1`でHDRへ切り替える | 確認 | `r.AllowHDR`はread-onlyでコード既定値0。RHIと対象表示のHDR対応も必要。 |
| UE 5.8ではFilmicとStandard ACESを選べる | 確認 | Post Process VolumeのFilm > Method、または`r.LUT.TonemappingMethod`で選択する。 |
| `r.LUT.TonemappingMethod=-1/0/1`はPost Process設定／Filmic／Standard ACES | 確認 | CVarが0以上ならPost Process設定よりCVarが優先される。0または1以外を検証・clampするコードは確認できない。 |
| Tonemapping Methodの既定はFilmic | 確認 | `FPostProcessSettings`の初期値はFilmic。CVarの既定`-1`はPost Process設定を使う。 |
| Standard ACESではSlope、Toe等が効かない | 確認 | enumのTooltipに明記され、シェーダーもFilm curve計算を通らない。Color Gradingや露出まで無効になるという意味ではない。 |
| FilmicはSDR向け、Standard ACESはHDR向け | 要補足 | 両方式ともSDR/HDRで動く。CVar説明ではStandard ACESのSDR既定EOTFはBT.1886、FilmicはsRGBであり、設計傾向は異なる。 |
| UE 5.8ではACES 2.0が既定 | 現ソースで確認 | `r.HDR.Aces.Version`の初期値は2。ただし同CVarのヘルプにはACES 1.3がdefaultと残り、ソース内で矛盾する。 |
| UE 5.7ではACES 1.3が既定 | 確認不能 | 5.7比較ソースまたは履歴が必要。 |
| Standard ACESで`r.HDR.Aces.SceneColorMultiplier`が効く | ACES 2.0で確認 | Paper White比率との積がACES Output Transform前のシーン色へ掛かる。SDR/HDR双方で同じ経路を使える。 |
| Filmicでは`SceneColorMultiplier`が効かない | 実装上妥当 | Filmic HDRのinner LUTでは逆ACES変換時の除算と再出力時の乗算で同倍率が相殺される。Filmic SDRは通常inner LUTを必要としない。 |
| ACES 1.3ではMin/Mid/Max Luminanceで曲線を設定する | 確認 | 3値から従来の`FACESTonemapParams`を生成する。 |
| ACES 2.0では主にMax LuminanceとPaper Whiteを使う | 概ね確認 | MaxはOutput Transformへ渡り、Paper Whiteはシーン倍率へ入る。Min/Midは従来データとして生成されるが`USE_ACES_2`分岐では使われない。 |
| Paper Whiteで低～中輝度を調整する | 要修正 | 実装はシーン全体をスケールする。特定の輝度域だけを制御する値ではない。 |
| Overrideが0なら表示値、1ならユーザー値 | 確認 | HDR時は1なら`r.HDR.Display.MaxLuminance`、0ならRenderTargetの最大輝度。SDRかつoverride時は100 nit。 |
| HDR UIは`UI.Level`または独立UI luminanceで調整できる | 確認 | 既定ではUI luminanceは独立せずPaper Whiteへ追従する。独立値には`r.HDR.UI.Luminance.Mode=1`が必要。 |

### 13.3 Tonemapping Method、ACES Version、Display Outputは別設定

利用者は次の3層を分けて考える必要がある。

1. Tonemapping Method: Filmic／Standard ACES
2. ACES Version: ACES 1.3／2.0
3. Display Output: SDR、PQ/ST 2084 HDR、scRGB HDR等

例えばFilmic + ACES 2.0 + PQ HDRも、Standard ACES + ACES 2.0 + SDRもコード上は存在する。

| Method | 処理の性格 | Filmパラメータ | SDR/HDR |
|---|---|---|---|
| Filmic | UE Film curveを作り、HDR時はACES Output Transformで表示へ再マッピングする | Slope、Toe、Shoulder等が有効 | 両方で動作 |
| Standard ACES | シーン／Color Grading結果をACES Output Transformへ渡す | Slope、Toe、Shoulder等は無効 | 両方で動作 |

根拠:

- `Engine/Source/Runtime/Engine/Classes/Engine/Scene.h:72-79,1597-1598`
- `Engine/Source/Runtime/Engine/Private/Scene.cpp:440-445`
- `Engine/Source/Runtime/Renderer/Private/PostProcess/PostProcessCombineLUTs.cpp:72-88,319-339,792-815`
- `Engine/Shaders/Private/PostProcessCombineLUTs.usf:294-341`
- `Engine/Shaders/Private/PostProcessCombineLUTsInner.usf:107-137`

### 13.4 選択方法と優先順位

通常はPost Process VolumeのFilm > Methodを設定する。全Viewへ強制する場合は`r.LUT.TonemappingMethod`を使う。

```ini
; Post Process Volumeの設定を使う（CVar既定）
r.LUT.TonemappingMethod=-1

; 強制的にFilmic
r.LUT.TonemappingMethod=0

; 強制的にStandard ACES
r.LUT.TonemappingMethod=1
```

CVarが0以上ならPost Process Volumeより優先される。Standard ACESではFilm設定が適用されないため、既存プロジェクトを切り替えるとFilmSlope、FilmToe、FilmShoulder等で作った見た目は維持されない可能性が高い。

### 13.5 HDRを有効にする最小構成

起動前にプロジェクト側でHDRを許可する。

```ini
[/Script/Engine.RendererSettings]
r.AllowHDR=1
```

実行時は`UGameUserSettings::EnableHDRDisplayOutput`を使う。動作確認だけなら次でも切り替えられる。

```text
r.HDR.EnableHDROutput 1
```

`r.AllowHDR`だけではHDR表示を有効化しない。さらにRHIと表示のHDR対応が必要である。製品コードではCVarを直接固定するより、`UGameUserSettings`による有効化、保存、適用を基本とする。

### 13.6 Standard ACES 2.0の明るさ関連値

実装上、主要値は次のように使われる。

```text
ACES入力倍率 = (Paper White [nit] / 203) × SceneColorMultiplier
ACES Output Transformのピーク = OutputMaxLuminance [nit]
```

#### `r.HDR.Aces.SceneColorMultiplier`

- Standard ACES 2.0ではシーン全体をOutput Transform前にスケールする。
- SDRとHDRの双方で共通の調整にできる。
- 露出に似た全体変化を生むが、自動露出の測光設定そのものを変更する値ではない。
- コード既定値は`1.5`。
- Filmic HDRでは同倍率が逆変換と再変換で相殺される構造である。この値を利用者向け明るさ設定に使うなら、Standard ACESを明示するというPDFの結論は妥当である。

#### `r.HDR.PaperWhite`

- コード既定値は203 nit。
- ACES 2.0では`PaperWhite / 203`がSceneColorMultiplierへ乗算される。
- 低～中輝度専用ではなく、Output Transformへ入るシーン全体の基準倍率である。
- 既定ではHDR UIも同じPaper Whiteを使うため、変更すると3DシーンとUIの双方が変化し得る。
- プラットフォームがPaper Whiteを提供できる場合、`r.HDR.PaperWhite.Mode=0`ではプラットフォーム値が優先される。手動値を確実に使うにはModeを1にする。

#### 最大表示輝度

- `r.HDR.Display.OverrideOSMaxLuminance=0`: 対象RenderTarget／表示の最大輝度を使う。
- `r.HDR.Display.OverrideOSMaxLuminance=1`: HDR時は`r.HDR.Display.MaxLuminance`を使う。
- 最大輝度はACES 2.0 Output Transformのピーク条件であり、単純な全体輝度倍率ではない。
- 実表示能力より低く設定すればハイライト側の利用範囲を狭める。通常の明るさスライダーより、ディスプレイ較正値として扱う方が実装意図に近い。

`r.HDR.Display.MinLuminanceLog10`と`r.HDR.Display.MidLuminance`はACES 1.3用パラメータ生成には使われるが、ACES 2.0シェーダー分岐はそのデータを参照しない。

根拠:

- `Engine/Source/Runtime/Renderer/Private/PostProcess/PostProcessCombineLUTs.cpp:600-630`
- `Engine/Shaders/Private/PostProcessCombineLUTsInner.usf:59-83,107-137`
- `Engine/Source/Runtime/Renderer/Private/PostProcess/PostProcessTonemap.cpp:284-293`
- `Engine/Source/Runtime/RenderCore/Private/RenderCore.cpp:358-405,1031-1061`

### 13.7 UIを独立して調整する場合

既定の`r.HDR.UI.Luminance.Mode=0`ではUIはPaper Whiteへ追従する。3DシーンのPaper Whiteを変えつつUIを一定に保つ場合は、UIを独立させる。

```text
r.HDR.UI.Luminance.Mode 1
r.HDR.UI.Luminance 203
```

`r.HDR.UI.Level`は基準UI輝度へ掛かる倍率として使える。製品では次のGameUserSettings APIを使用できる。

- `SetHDRPaperWhiteNits`
- `SetHDRUILuminanceSeparate`
- `SetHDRUILuminanceNits`

### 13.8 ゲーム設定画面への組み込み

ソースから読み取れる役割分担は次のとおり。

1. HDRの有効／無効: `EnableHDRDisplayOutput`
2. 表示ピークのユーザー較正: `SetMaximumHDRDisplayNits`と`SetHDRCalibrationUsed`
3. シーンのReference White: `SetHDRPaperWhiteNits`
4. UIを独立させる場合: `SetHDRUILuminanceSeparate`と`SetHDRUILuminanceNits`
5. 設定変更後: 通常のGameUserSettings保存・適用フローを使う

Lyraは最大輝度較正をPQ空間で操作し、Paper Whiteを別設定として公開している。最大輝度とPaper Whiteを1つの「明るさ」スライダーへ混在させない設計の参考になる。

`r.HDR.Aces.SceneColorMultiplier`には、今回確認した範囲で専用のGameUserSettingsプロパティはない。ゲーム固有の共通明るさ設定として公開する場合は、保存、適用タイミング、範囲をゲーム側で設計する。また、Standard ACESへ固定するか、Methodによって効果が異なることを扱う必要がある。

### 13.9 実機で確認すべき項目

- 自動露出を固定したテストシーンでの18% grayとReference White
- 表示ピーク付近のハイライトとクリッピング
- 高彩度エミッシブの色相と飽和
- FilmicからStandard ACESへ切り替えた際のFilm設定消失
- Paper White変更時の3DシーンとUIの連動
- OS取得最大輝度とゲーム内較正値の差
- SDR/HDRで同じ`SceneColorMultiplier`を使った際の知覚的な一致

ソースは処理経路を示すが、表示個体、OS設定、視聴環境を含む最終的な見え方までは保証しない。製品の既定値とスライダー範囲は対応実機で検証して決める必要がある。
