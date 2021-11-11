class OmronEnvSensor {
  constructor() {
    // 接続・切断ボタンの button 要素
    this.req_btn_el = document.getElementById('req-btn');

    // SerialPort オブジェクト
    this.port = null;

    // シリアルポートの ReadableStream と WritableStream オブジェクト
    this.reader = null;
    this.writer = null;

    // 計測データ取得の間隔 (ミリ秒)
    this.REQUEST_INTERVAL = 1000;
  }

  // -----------------------------------------------------------
  // 初期化
  // -----------------------------------------------------------
  init() {
    // Web Serial API をサポートしているかをチェック
    if ("serial" in navigator) {
      document.getElementById('supported').hidden = false;
      this.req_btn_el.addEventListener('click', async () => {
        if (this.port) {
          await this.disconnect();
        } else {
          await this.connect();
        }
      });
    } else {
      document.getElementById('notsupported').hidden = false;
    }
  }

  // -----------------------------------------------------------
  // 環境センサーに接続
  // -----------------------------------------------------------
  async connect() {
    this.req_btn_el.classList.add('is-loading');
    // ユーザーにシリアルポート選択画面を表示して選択を待ち受ける
    try {
      this.port = await navigator.serial.requestPort({
        filters: [{ usbVendorId: 0x0590, usbProductId: 0x00D4 }]
      });
    } catch (error) {
      console.error(error);
      // ユーザーがキャンセルを押した場合
      this.port = null;
      this.req_btn_el.classList.remove('is-loading');
      return;
    }

    // ユーザーが選択したシリアルポートに接続
    try {
      await this.port.open({
        baudRate: 115200,
        //dataBits: 8, // 7 or 8 (デフォルト)
        //stopBits: 1, // 1 or 2 (デフォルト)
        //parity: 'none', // "none" (デフォルト), "even", or "odd"
        //flowControl: 'none' // "none" (デフォルト) or "hardware"
      });
      this.req_btn_el.textContent = '切断する';
      this.req_btn_el.classList.remove('is-loading');

      // シリアルポートの ReadableStream と WritableStream を取得
      this.reader = this.port.readable.getReader();
      this.writer = this.port.writable.getWriter();

      // センサーの計測値の取得を開始
      this.startMonitor();

    } catch (error) {
      console.error(error);
      this.reader = null;
      this.writer = null;
      this.port = null;
      window.alert(error.message);
    }
  }

  // -----------------------------------------------------------
  // 環境センサーを切断
  // -----------------------------------------------------------
  async disconnect() {
    this.req_btn_el.classList.remove('is-loading');

    this.reader.releaseLock();
    this.writer.releaseLock();
    await this.port.close();
    this.port = null;

    this.req_btn_el.textContent = '接続する';
    this.req_btn_el.classList.remove('is-loading');
  }

  // -----------------------------------------------------------
  // 計測データ取得の開始
  // -----------------------------------------------------------
  async startMonitor() {
    // リクエストデータ生成
    const req_data = this.createRequestData();

    while (this.port) {
      // リクエスト送信
      await this.writer.write(req_data);

      // レスポンスを受信
      const { value } = await this.reader.read();
      this.parseResponse(value);

      // タイムスタンプを表示
      this.showTimestamp();

      // 指定秒数だけ待つ
      await this.wait(this.REQUEST_INTERVAL);
    }
  }

  // -----------------------------------------------------------
  // 指定秒数だけ待つ
  // -----------------------------------------------------------
  wait(msec) {
    return new Promise((resolve) => {
      window.setTimeout(() => {
        resolve();
      }, msec);
    });
  }

  showTimestamp() {
    const dt = new Date();
    const time = [
      ('0' + dt.getHours().toString()).slice(-2),
      ('0' + dt.getMinutes().toString()).slice(-2),
      ('0' + dt.getSeconds().toString()).slice(-2)
    ].join(':');
    const el = document.getElementById('timestamp');
    el.textContent = time;
  }

  // -----------------------------------------------------------
  // リクエストデータ生成 (Uint8Array)
  // -----------------------------------------------------------
  createRequestData() {
    // Header
    const header_view = new Uint8Array([0x52, 0x42]);
    // Length (Payload ～ CRC-16)
    const length_view = new Uint16Array([5]);
    // Payload frame
    const command_view = new Uint8Array([0x01]); // 0x01: Read, 0x02: Write
    const address_view = new Uint16Array([0x5022]); // 0x5022: Latest data short
    // CRC-16 (Header ～ Payload)
    const crc = this.calcCrc16([header_view, length_view, command_view, address_view]);
    const crc_view = new Uint16Array([crc]);
    // 各 Typed Array を結合して 1 つの Uint8 Typed Array にする
    const req_data = this.concatTypedArrays([header_view, length_view, command_view, address_view, crc_view]);
    return req_data;
  }

  // -----------------------------------------------------------
  // Typed Array オブジェクトのリストを 1 つの Uint8Array に連結
  // -----------------------------------------------------------
  concatTypedArrays(typed_array_list) {
    const byte_list = [];
    for (let typed_array of typed_array_list) {
      let uint8_view = new Uint8Array(typed_array.buffer, 0);
      for (let byte of uint8_view) {
        byte_list.push(byte);
      }
    }
    return new Uint8Array(byte_list);
  }

  // -----------------------------------------------------------
  // Typed Array のリストから CRC-16 を算出
  // -----------------------------------------------------------
  calcCrc16(typed_array_list) {
    const byte_list = this.concatTypedArrays(typed_array_list);
    let reg = 0xffff;
    for (let i = 0; i < byte_list.length; i++) {
      reg = reg ^ byte_list[i];
      let bit_shift = 0;
      while (true) {
        let last_bit = reg & 1;
        reg = reg >>> 1;
        if (last_bit === 1) {
          reg = reg ^ 0xA001;
        }
        bit_shift++;
        if (bit_shift >= 8) {
          break;
        }
      }
    }
    return reg;
  }

  // -----------------------------------------------------------
  // レスポンスをパース
  // -----------------------------------------------------------
  parseResponse(data) {
    const hex_list = [];
    for (let byte of data) {
      hex_list.push(byte.toString(16).padStart(2, '0'));
    }

    if (data[0] !== 0x52 || data[1] !== 0x42) {
      return;
    }

    const data_view = new DataView(data.buffer);
    const len = data_view.getUint16(2, true);
    if (len !== data.byteLength - 4) {
      console.log('レスポンスのバイト長異常を検知したため受信データを破棄しました: ' + len + ',' + data.byteLength);
      return;
    }

    const command = data_view.getUint8(4);
    const address = data_view.getUint16(5, true);
    if (address !== 0x5022) {
      console.log('レスポンスのアドレスが未知のため受信データを破棄しました: address=' + address);
      return;
    }

    const sequence_number = data_view.getUint8(7);
    const temperature = data_view.getInt16(8, true) / 100; // degC
    const humidity = data_view.getInt16(10, true) / 100; // %RH
    const anbient_light = data_view.getInt16(12, true); // lx
    const pressure = data_view.getInt32(14, true) / 1000; // hPa
    const noise = data_view.getInt16(18, true) / 100; // dB
    const etvoc = data_view.getInt16(20, true); // ppb
    const eco2 = data_view.getInt16(22, true); // ppm
    const discomfort_index = data_view.getInt16(24, true) / 100;
    const heat_stroke = data_view.getInt16(26, true) / 100; // degC

    /*
    const lines = [];
    lines.push('- Sequence number: ' + sequence_number);
    lines.push('- Templerature: ' + temperature + ' degC');
    lines.push('- Relative humidity: ' + humidity + ' %RH');
    lines.push('- Ambient light: ' + anbient_light + ' lx');
    lines.push('- Barometric pressure: ' + pressure + ' hPa');
    lines.push('- Sound noise: ' + noise + ' dB');
    lines.push('- eTVOC: ' + etvoc + ' ppb');
    lines.push('- eCO2: ' + eco2 + ' ppm');
    lines.push('- Discomfort index: ' + discomfort_index);
    lines.push('- Heat stroke: ' + heat_stroke + ' degC');
    console.log(lines.join('\n'));
    */

    // 画面に反映
    document.getElementById('temperature').textContent = temperature.toFixed(1);
    document.getElementById('humidity').textContent = humidity.toFixed(1);
    document.getElementById('anbient_light').textContent = anbient_light;
    document.getElementById('pressure').textContent = pressure.toFixed(1);
    document.getElementById('noise').textContent = noise.toFixed(1);
    document.getElementById('etvoc').textContent = etvoc;
    document.getElementById('eco2').textContent = eco2;
    document.getElementById('discomfort_index').textContent = discomfort_index.toFixed(1);
    document.getElementById('heat_stroke').textContent = heat_stroke.toFixed(1);

    // 不快指数の色分け
    let discomfort_index_color = '';
    let discomfort_index_desc = '';
    if (discomfort_index < 70) {
      discomfort_index_color = 'has-background-primary-light';
      discomfort_index_desc = '快い';
    } else if (discomfort_index < 75) {
      discomfort_index_color = 'has-background-success-light';
      discomfort_index_desc = '暑くない';
    } else if (discomfort_index < 80) {
      discomfort_index_color = 'has-background-warning-light';
      discomfort_index_desc = 'やや暑い';
    } else if (discomfort_index < 85) {
      discomfort_index_color = 'has-background-warning';
      discomfort_index_desc = '暑くて汗が出る';
    } else {
      discomfort_index_color = 'has-background-danger	';
      discomfort_index_desc = '暑くてたまらない';
    }
    const discomfort_index_cont_el = document.getElementById('discomfort_index_cont');
    for (let token_data of discomfort_index_cont_el.classList.entries()) {
      const token = token_data[1];
      if (token.startsWith('has-background-')) {
        if (token !== discomfort_index_color) {
          discomfort_index_cont_el.classList.remove(token);
        }
        break;
      }
    }
    discomfort_index_cont_el.classList.add(discomfort_index_color);

    const discomfort_index_desc_el = document.getElementById('discomfort_index_desc');
    discomfort_index_desc_el.textContent = discomfort_index_desc;

    // 熱中症警戒度の色分け
    let heat_stroke_color = '';
    let heat_stroke_desc = '';
    if (heat_stroke < 25) {
      heat_stroke_color = 'has-background-success-light';
      heat_stroke_desc = '注意';
    } else if (heat_stroke < 28) {
      heat_stroke_color = 'has-background-warning-light';
      heat_stroke_desc = '警戒';
    } else if (heat_stroke < 31) {
      heat_stroke_color = 'has-background-warning';
      heat_stroke_desc = '厳重警戒';
    } else {
      heat_stroke_color = 'has-background-danger	';
      heat_stroke_desc = '危険';
    }
    const heat_stroke_cont_el = document.getElementById('heat_stroke_cont');
    for (let token_data of heat_stroke_cont_el.classList.entries()) {
      const token = token_data[1];
      if (token.startsWith('has-background-')) {
        if (token !== heat_stroke_color) {
          heat_stroke_cont_el.classList.remove(token);
        }
        break;
      }
    }
    heat_stroke_cont_el.classList.add(heat_stroke_color);

    const heat_stroke_desc_el = document.getElementById('heat_stroke_desc');
    heat_stroke_desc_el.textContent = heat_stroke_desc;

  }
}

(new OmronEnvSensor()).init();