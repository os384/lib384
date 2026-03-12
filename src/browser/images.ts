// (c) 2023 384 (tm)

// thank you Thomas Lochmatter, thomas.lochmatter@viereck.ch, for jpeg ref code

// takes a JPEG image and extracts and returns key meta data
export function readJpegHeader(bytes: Uint8Array) {	
    console.log("==== loaded SBImageHelper lib version 0.0.10 ====");
    // Check for valid JPEG header (null terminated JFIF)
    let position = 0
    if (bytes[position ++] !== 0xff) return
    if (bytes[position ++] !== 0xd8) return
    // Go through all markers
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    // Marker format:
    //   0xff, marker type, length in bytes
    // Marker types are in the range 0xc0-0xfe
    //   Skip markers that are not SOFn (Start of Frame)
    //   SOFn markers have a length of 7-11 bytes
    //   SOFn markers are either 0xc0 (baseline DCT) or 0xc2 (progressive DCT)
    //   SOFn markers have 1 byte for the type, 2 bytes for the length
    //   (1 byte for the precision, 2 for the height, and 2 for the width)
    //   The rest of the data in the marker is variable
    while (position + 4 < bytes.byteLength) {
      // Check that it's a valid marker
      // FF00 is a special marker used to stuff extra bits into the stream
      // (it's a valid marker, but it's not actually a marker)
      if (bytes[position ++] !== 0xff)
        continue
      // Get the marker type
      const type = bytes[position ++]
      if (bytes[position] == 0xff)
        // FF00 was found, so skip it
        continue
      const length = dv.getUint16(position, false) // big endian
      if (position + length > bytes.byteLength) return null
      if (length >= 7 && (type == 0xc0 || type == 0xc2)) {
        const data = {
            progressive: type == 0xc2,
            bitDepth: bytes[position + 2],
            height: dv.getUint16(position + 3, false),
            width: dv.getUint16(position + 5, false),
            components: bytes[position + 7]
        }
        return data
      }
      position += length
    }
    return null
  }
