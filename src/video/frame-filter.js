// The studio frame in ffmpeg's filter graph: the recording put inside the window drawn by render/page/frame.js.

// The video part of the filter graph: the cut recording `[cut]` goes into the window. Inputs `bg` and `mask`
// are the indexes of the two pictures (looped).
/** @param {{ x: number, y: number, width: number, height: number }} f @param {number} bg @param {number} maskInput */
export const frameFilter = (f, bg, maskInput) =>
  `[cut]scale=${f.width}:${f.height}:flags=lanczos,format=yuva420p[rec];[${maskInput}:v]format=gray,scale=${f.width}:${f.height}[fm];` +
  `[rec][fm]alphamerge[win];[${bg}:v]format=yuv420p[fb];[fb][win]overlay=${f.x}:${f.y}:shortest=1:format=auto[vout]`
