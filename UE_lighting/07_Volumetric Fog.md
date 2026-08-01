# Volumetric Fog

Volumetric FogはTLVとは別のcamera-frustum-aligned froxel volumeで、participating mediumの散乱・吸収をcamera ray方向へ積分する。

## Resource

| Resource | 内容 |
|---|---|
| `VBufferA.rgb` | `Albedo × Extinction`に相当するscattering coefficient |
| `VBufferA.a` | Extinction |
| `VBufferB.rgb` | Emissive |
| `LightScattering` | Lightをmediumへ適用した局所in-scattering＋Extinction |
| `IntegratedLightScattering.rgb` | cameraから各depthまでの積分済みin-scattering |
| `IntegratedLightScattering.a` | 積分済みTransmittance |

## Mediumの入力

- Exponential Height Fog
- Local Fog Volume
- Volume Domain particle／primitive
- Substrate Volumetric-Fog-Cloud BSDF

Volume voxelizerがSubstrate BSDFから明示的に読むのはAlbedo、Extinction、Emissive。通常経路の`PhaseG`はExponential Height FogのScattering Distributionから渡される。

## Lighting

Directional Light、unshadowed Local Light、shadowed Local Light、SkyLight、Lumen Translucency GI Volume、Volumetric Lightmap、MegaLights Volume等を条件付きで統合する。Shadow sourceにはProjected Shadow、VSM、static shadow、オプションのray traced shadow volumeがある。

```text
InScattering = Light × Attenuation × Visibility
             × LightFunction × PhaseFunction
             × VolumetricScatteringIntensity
             × MediumScattering
```

## GridとTemporal

既定はXY 16 pixel/cell、Z 64 slice。Zは非線形depth分布。Temporal Reprojectionとjitterは既定有効、History Weightは0.9である。低解像度を安定化する一方、急変するLightで残像が生じ得る。

## Integrationと合成

`FinalIntegrationCS`がcamera側から各Z sliceを積分する。

```text
Transmittance = exp(-Extinction × StepLength)
FoggedColor = IntegratedInScattering + SceneColor × Transmittance
```

Opaqueにはfog composite、Lit TranslucencyにはBase Pass内で自身のdepthに対応するfogが適用される。

