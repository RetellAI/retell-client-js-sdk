Check out
[Retell AI Web Call Guide](https://docs.retellai.com/deploy/web-call) for
how to use this SDK.

When `emitRawAudioSamples` is enabled, the `audio` event contains
`Float32Array` snapshots from a Web Audio analyser for visualization. The
snapshots are sampled on animation frames and are not a continuous PCM stream.
