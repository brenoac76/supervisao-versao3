const fs = require('fs');
let file = fs.readFileSync('components/PersonalAgenda.tsx', 'utf8');
file = file.replace(/const result = await response.json\(\);\n                          if \(\!result.success \|\| \!result.url\) throw new Error\(result.message \|\| 'Falha no upload'\);/g, 'const result = await safeJSONFetch(response);\n                          if (!result || !result.success || !result.url) throw new Error(result?.message || \\'Falha no upload\\');');
fs.writeFileSync('components/PersonalAgenda.tsx', file);
