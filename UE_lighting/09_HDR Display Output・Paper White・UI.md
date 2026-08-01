# HDR Display Output・Paper White・UI

## HDR有効化

少なくとも以下が必要である。

1. `r.AllowHDR=1`
2. `r.HDR.EnableHDROutput=1`
3. RHIの対応
4. 対象displayのHDR対応

両CVarのcode既定値は0。Windows／D3D12ではDXGIからdisplayのHDR対応、最大／最小輝度、色域を取得する経路を確認した。

## Display Output

Display Outputは単独の「画像書き出しpass名」ではなく、Output Device、target peak luminance、gamut、encoding等の条件群である。Standard ACES 2.0はこの条件を受けて表示変換を行い、その後PQまたはscRGB等へencodingする。

家庭用TV／console／Windows PCのHDR10経路ではRec.2020 container＋ST 2084/PQ＋10-bit swap chainが一般的。ただしPQは1000 nit固定ではなく、UEの1000／2000 nit名はtarget peakを表す。

## Paper WhiteとSceneColorMultiplier

Standard ACES 2.0のscene側では次の積へまとめられる。

```text
TotalSceneColorMultiplier
  = (PaperWhiteNits / 203)
  × r.HDR.Aces.SceneColorMultiplier
```

どちらもsceneに対してはlinearな乗算だが、意味と影響範囲が異なる。

| 項目 | Paper White | SceneColorMultiplier |
|---|---|---|
| 単位 | nit | 無次元 |
| 意味 | HDR Reference White | ACES inputの追加倍率 |
| 既定 | 203 | 1.5 |
| UI | 既定UI luminanceも追従 | Slate UIは変化しない |
| GameUserSettings | APIあり | 専用APIを確認できない |

Paper Whiteはcurve係数を直接変更せず、ACES Output Transform前のinput倍率に含まれる。ただしinputがcurveの別領域へ移るため、出力差は単純な表示後倍率には見えない。

## HDR UI composite

通常Slate UIは3D sceneのTonemap／display encoding後にHDR専用passで合成する。PQの場合はsceneをPQからlinear nitsへ戻し、Slate UIをlinearizeしてRec.2020／linear-nits基準で合成し、PQへ再encodingする。scRGBもlinear-nits相当へ揃えて合成する。

- `r.HDR.UI.Luminance.Mode=0`: Paper Whiteへ追従
- `Mode=1`: `r.HDR.UI.Luminance`を独立使用
- `r.HDR.UI.Level`: 追加倍率

したがって既定ではPaper WhiteがsceneとUIの両方を変え、SceneColorMultiplierはsceneだけを変える。

