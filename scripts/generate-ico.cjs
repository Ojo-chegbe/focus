const fs = require('fs');
const path = require('path');

async function main() {
  const pngToIcoModule = require('png-to-ico');
  const pngToIco = pngToIcoModule.default || pngToIcoModule;
  const inputPng = path.join(__dirname, '../build/icon.png');
  const outputBuildIco = path.join(__dirname, '../build/icon.ico');
  const outputPublicIco = path.join(__dirname, '../public/favicon.ico');

  console.log(`Generating ICO from ${inputPng}...`);
  const buf = await pngToIco(inputPng);
  fs.writeFileSync(outputBuildIco, buf);
  fs.writeFileSync(outputPublicIco, buf);
  fs.writeFileSync(path.join(__dirname, '../build/Focus.ico'), buf);
  fs.writeFileSync(path.join(__dirname, '../public/icon.ico'), buf);
  console.log(`Generated ${outputBuildIco} (${buf.length} bytes) and icons in public/`);
}

main().catch(err => {
  console.error('Error generating ICO:', err);
  process.exit(1);
});
