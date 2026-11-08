import { net } from 'electron';

export interface WarrantyInfo {
  serial: string;
  warranty_status: string;
  model_name: string;
  model_color: string;
  warranty_end?: string;
}

export async function checkWarranty(serial: string): Promise<WarrantyInfo> {

  function makeRequest(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const request = net.request(url);
      request.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      request.setHeader('Accept-Charset', 'utf-8');

      // Set timeout to 7 seconds
      const timeout = setTimeout(() => {
        request.abort();
        reject(new Error('Request timeout'));
      }, 7000);

      request.on('response', (response) => {
        clearTimeout(timeout);

        if (response.statusCode !== 200) {
          request.abort();
          reject(new Error(`HTTP Error: ${response.statusCode}`));
          return;
        }

        let buffers: Buffer[] = [];
        response.on('data', (chunk) => {
          buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          try {
            const fullBuffer = Buffer.concat(buffers);
            const data = fullBuffer.toString('utf8');
            const cleanData = data.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
            resolve(cleanData);
          } catch (error) {
            reject(error);
          }
        });
      });
      request.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      request.end();
    });
  }

  function parseRecciHtml(html: string) {
    const stripTags = (str: string) => str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    const getMatch = (pattern: RegExp) => {
      const m = html.match(pattern);
      return m ? stripTags(m[1]) : '';
    };

    const ptitle = getMatch(/<[^>]+class=["'][^"']*ptitle[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);

    const valMatches: string[] = [];
    const valRegex = /<[^>]+class=["'][^"']*val[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi;
    let valMatch;
    while ((valMatch = valRegex.exec(html)) !== null) {
      valMatches.push(stripTags(valMatch[1]));
    }

    let rawModel = '';
    let rawColor = '';

    if (valMatches.length >= 3 && valMatches[0].toUpperCase().includes('ROBOROCK')) {
      rawModel = valMatches[1];
      rawColor = valMatches[2];
    } else if (valMatches.length === 2 && valMatches[0].toUpperCase().includes('ROBOROCK')) {
      rawModel = valMatches[1];
      rawColor = '';
    } else if (valMatches.length >= 2) {
      rawModel = valMatches[0];
      rawColor = valMatches[1];
    } else if (valMatches.length === 1) {
      rawModel = valMatches[0];
    } else {
      rawModel = ptitle;
    }

    const cleanText = stripTags(html);

    // Status pills in Recci UI:
    // Green: <div class="pill green"> Ürün Resmi Roborock Türkiye Üretici Garantisi Kapsamındadır. </div>
    // Red / Danger: <div class="pill red"> Bu ürün Roborock Türkiye Garanti kapsamında değildir! </div>
    // Amber / Expired: <div class="pill amber"> Garanti süresi dolmuştur </div>
    const isGreenPill = /class=["'][^"']*pill\s+[^"']*green/i.test(html) ||
                        /class=["'][^"']*green[^"']*pill/i.test(html);

    const isRedPill = /class=["'][^"']*pill\s+[^"']*(red|danger)/i.test(html) ||
                      /class=["'][^"']*(red|danger)[^"']*pill/i.test(html);

    const isAmberPill = /class=["'][^"']*pill\s+[^"']*(amber|warning)/i.test(html);

    const isNotGarantili = isRedPill ||
                           /kapsam[ıi]nda\s+de[ğg]ildir/i.test(cleanText) ||
                           /garanti\s+kapsam[ıi]\s+d[ıi][şs][ıi]/i.test(cleanText);

    const isExpired = !isNotGarantili && (
      isAmberPill ||
      /garanti(?:si)?\s+s[üu]resi\s+dolmu[şs]tur/i.test(cleanText)
    );

    const isGarantili = !isNotGarantili && (
      isGreenPill ||
      (/garanti(?:si)?\s+kapsam[ıi]ndad[ıi]r/i.test(cleanText) && !/de[ğg]ildir/i.test(cleanText))
    );

    let warranty_end = '';
    const dateItemRegex = /<[^>]+class=["'][^"']*date-item[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi;
    let dateMatch;
    while ((dateMatch = dateItemRegex.exec(html)) !== null) {
      const text = stripTags(dateMatch[1]);
      if (/biti[şs]/i.test(text)) {
        const m = text.match(/\d{2}\.\d{2}\.\d{4}/);
        if (m) warranty_end = m[0];
      }
    }

    if (!warranty_end) {
      const genMatch = cleanText.match(/(?:garanti(?:si)?\s*)?biti[şs][^\d]*(\d{2}\.\d{2}\.\d{4})/i);
      if (genMatch) warranty_end = genMatch[1];
    }

    return { rawModel, rawColor, ptitle, cleanText, isGarantili, isExpired, isNotGarantili, warranty_end };
  }

  try {
    const html = await makeRequest(`https://www.recciteknoloji.com/garantibelgesi2/?q=${serial}`);
    const parsed = parseRecciHtml(html);

    let model_name = (parsed.rawModel || parsed.ptitle).toUpperCase().trim()
      .replace(/^(MODEL|MARKA)\s*:\s*/i, '')
      .replace(/^(MODEL|MARKA)\s*/i, '')
      .trim();

    let model_color = (parsed.rawColor || '').toUpperCase().trim()
      .replace(/^RENK\s*:\s*/i, '')
      .replace(/^RENK\s*/i, '')
      .trim();

    if (!model_color && parsed.ptitle) {
      const parts = parsed.ptitle.split(' ');
      if (parts.length > 1) {
        const lastWord = parts[parts.length - 1].toUpperCase();
        if (['SİYAH', 'BEYAZ', 'GRİ', 'KIRMIZI', 'MAVİ', 'GOLD', 'ROSE'].includes(lastWord)) {
          model_color = lastWord;
          if (!model_name || model_name === 'ROBOROCK') {
            model_name = parts.slice(0, -1).join(' ').trim();
          }
        }
      }
    }

    // Strip ROBOROCK brand prefix
    model_name = model_name.replace(/^ROBOROCK\s+/i, '').replace(/^ROBOROCK$/i, '').trim();

    // Standardize QREVO to Q REVO
    model_name = model_name.replace(/QREVO/g, 'Q REVO');

    if (model_name.includes('S8')) {
      model_name = model_name.replace(/SON[Iİ]C/g, '').trim();
    }

    if (model_color && model_name.endsWith(model_color)) {
      model_name = model_name.substring(0, model_name.length - model_color.length).trim();
    }

    const isValidRecci = !parsed.isNotGarantili && (parsed.isGarantili || parsed.isExpired);

    if (isValidRecci) {
      if (!model_name) {
        model_name = 'ROBOROCK';
      }

      const statusStr = (parsed.isExpired && !parsed.isGarantili)
        ? 'RECCI GARANTILI (SÜRESİ DOLMUŞ - FATURA KONTROL)'
        : 'RECCI GARANTILI';

      return {
        serial,
        warranty_status: statusStr,
        model_name,
        model_color,
        warranty_end: parsed.warranty_end || undefined
      };
    }
  } catch (error: any) {
    if (error.message && error.message.includes('HTTP Error:')) {
      // Fallback
    } else {
      throw new Error('TIMEOUT');
    }
  }

  try {
    const json = await makeRequest(`https://guvencesorgula.kvkteknikservis.com/api/device-data?imeiNo=${serial}`);

    const data = JSON.parse(json) as any;

    if (data.IsSucceeded && data.ResultData && Array.isArray(data.ResultData) && data.ResultData.length > 0 && data.ResultData[0] !== 'No data found') {
      const deviceData = data.ResultData[0];
      const description = deviceData.DESCRIPTION || '';

      let model_name = '';
      let model_color = '';

      if (description.toLowerCase().includes('roborock')) {
        const parts = description.split(' ');
        if (parts.length >= 3) {
          if (parts[0].toUpperCase() === 'ROBOROCK') {
            model_name = parts.slice(1, -1).join(' ').trim();
            model_color = parts[parts.length - 1].trim();
          } else {
            model_name = parts.slice(0, -1).join(' ').trim();
            model_color = parts[parts.length - 1].trim();
          }
        } else {
          model_name = description;
        }
      } else {
        model_name = description;
      }

      model_name = model_name.toUpperCase().trim();
      model_color = model_color.toUpperCase().trim();

      // Strip ROBOROCK brand prefix
      model_name = model_name.replace(/^ROBOROCK\s+/i, '').replace(/^ROBOROCK$/i, '').trim();

      // Standardize QREVO to Q REVO
      model_name = model_name.replace(/QREVO/g, 'Q REVO');

      if (model_name.includes('S8')) {
        model_name = model_name.replace(/SON[Iİ]C/g, '').trim();
      }

      if (model_color && model_name.endsWith(model_color)) {
        model_name = model_name.substring(0, model_name.length - model_color.length).trim();
      }

      return {
        serial,
        warranty_status: 'KVK GARANTILI',
        model_name,
        model_color,
        warranty_end: deviceData.WARRANTYEND
      };
    }
  } catch (error: any) {
    if (error.message && error.message.includes('HTTP Error:')) {
      // Fallback
    } else {
      throw new Error('TIMEOUT');
    }
  }

  return {
    serial,
    warranty_status: 'GARANTI KAPSAMI DISINDA',
    model_name: '',
    model_color: ''
  };
}
