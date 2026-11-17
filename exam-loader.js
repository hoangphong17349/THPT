/* ============================================================
   exam-loader.js — bộ nạp đề dùng chung cho mọi trang giao diện.
   KHÔNG cần sửa file này khi thay đề: chỉ sửa "de-kiem-tra.html".

   Cách hoạt động: trang giao diện mở file đề trong một khung ẩn,
   file đề gửi dữ liệu về qua postMessage, rồi bộ nạp kiểm tra và
   chuẩn hoá dữ liệu trước khi giao cho trang giao diện dùng.
   Cách này chạy được cả khi mở file trực tiếp (file://) lẫn khi
   đưa lên GitHub Pages.
   ============================================================ */
(function (global) {
  'use strict';

  var EXAM_FILE = 'de-kiem-tra.html';   // tên file đề (cùng thư mục)
  var TIMEOUT_MS = 6000;
  var LETTERS = ['A', 'B', 'C', 'D'];
  var DEFAULT_RANDOM = 10;              // số câu của chế độ ngẫu nhiên
  var DEFAULT_PICK_MAX = 20;            // số câu tối đa của chế độ tự chọn

  /* ---------- tiện ích nhỏ ---------- */
  function isStr(v) { return typeof v === 'string'; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function joinList(list, lastSep) {
    if (list.length <= 1) return list.join('');
    return list.slice(0, -1).join(', ') + lastSep + list[list.length - 1];
  }
  function posInt(v) { return typeof v === 'number' && isFinite(v) && v >= 1 && Math.floor(v) === v; }

  function makeError(messages) {
    var err = new Error(messages.join('\n'));
    err.messages = messages;
    return err;
  }

  /* ---------- kiểm tra + chuẩn hoá dữ liệu đề ---------- */
  function normalize(raw) {
    var errors = [];
    function bad(msg) { if (errors.length < 15) errors.push(msg); else if (errors.length === 15) errors.push('… và còn lỗi khác.'); }

    if (!raw || typeof raw !== 'object') {
      return { exam: null, errors: ['Dữ liệu đề không hợp lệ (EXAM phải là một đối tượng { ... }).'] };
    }

    // Các phần thi
    var sections = [], sectionById = {};
    if (!Array.isArray(raw.sections) || !raw.sections.length) {
      bad('Thiếu danh sách phần thi "sections".');
    } else {
      raw.sections.forEach(function (s, i) {
        if (!s || !isStr(s.id) || !s.id) { bad('Phần thi thứ ' + (i + 1) + ': thiếu "id".'); return; }
        if (sectionById[s.id]) { bad('Phần thi "' + s.id + '" bị trùng id.'); return; }
        var sec = {
          id: s.id,
          label: isStr(s.label) && s.label ? s.label : 'Phần ' + s.id,
          hint: isStr(s.hint) ? s.hint : '',
          instruction: isStr(s.instruction) ? s.instruction : ''
        };
        sections.push(sec);
        sectionById[sec.id] = sec;
      });
    }

    // Các câu hỏi
    var questions = [];
    if (!Array.isArray(raw.questions) || raw.questions.length < 2) {
      bad('Danh sách "questions" phải có ít nhất 2 câu.');
    } else {
      raw.questions.forEach(function (item, i) {
        var n = i + 1;
        if (!item || typeof item !== 'object') { bad('Câu ' + n + ': không phải một đối tượng { ... }.'); return; }
        var ok = true;

        if (!isStr(item.sec) || !sectionById[item.sec]) {
          bad('Câu ' + n + ': "sec" = ' + JSON.stringify(item.sec) + ' không trùng id phần thi nào.');
          ok = false;
        }
        if (item.q != null && !isStr(item.q)) { bad('Câu ' + n + ': "q" phải là chuỗi chữ.'); ok = false; }

        var opts = item.opts;
        if (!Array.isArray(opts) || opts.length < 2 || opts.length > LETTERS.length ||
            !opts.every(function (o) { return isStr(o) && o !== ''; })) {
          bad('Câu ' + n + ': "opts" phải có từ 2 đến ' + LETTERS.length + ' đáp án, mỗi đáp án là chữ không rỗng.');
          ok = false;
        }

        var ans = -1;
        if (isStr(item.ans) && /^[A-Da-d]$/.test(item.ans)) ans = item.ans.toUpperCase().charCodeAt(0) - 65;
        else if (typeof item.ans === 'number' && Math.floor(item.ans) === item.ans) ans = item.ans;
        if (ok && !(ans >= 0 && ans < opts.length)) {
          bad('Câu ' + n + ': "ans" = ' + JSON.stringify(item.ans) + ' không hợp lệ (dùng "A", "B", "C" hoặc "D" khớp số đáp án).');
          ok = false;
        }
        if (!ok) return;

        var sec = sectionById[item.sec];
        var q = isStr(item.q) ? item.q.trim() : '';
        // Dạng gọn dùng cho các trang hiển thị từng câu: "Question n. nội dung — gợi ý."
        var body = [q, sec.hint].filter(Boolean).join(' — ');
        if (sec.hint && !/[.?!:]$/.test(body)) body += '.';

        questions.push({
          n: n,
          sec: item.sec,
          q: q,
          hint: sec.hint,
          opts: opts.slice(),
          ans: ans,
          text: 'Question ' + n + '.' + (body ? ' ' + body : '')
        });
      });
    }

    if (errors.length) return { exam: null, errors: errors };

    var total = questions.length;
    var used = {};
    questions.forEach(function (x) { used[x.sec] = true; });
    var sectionsUsed = sections.filter(function (s) { return used[s.id]; });

    var minutes = posInt(raw.minutes) ? raw.minutes : Math.max(1, Math.ceil(total * 0.3));
    var randomCount = Math.min(posInt(raw.randomCount) ? raw.randomCount : DEFAULT_RANDOM, total);
    var pickMax = Math.min(posInt(raw.pickMax) ? raw.pickMax : DEFAULT_PICK_MAX, total);
    var subject = isStr(raw.subject) ? raw.subject.trim() : '';
    var grade = isStr(raw.grade) ? raw.grade.trim() : '';
    var topics = Array.isArray(raw.topics) ? raw.topics.filter(isStr).map(function (t) { return t.trim(); }).filter(Boolean) : [];

    return {
      errors: [],
      exam: {
        subject: subject,
        grade: grade,
        eyebrow: [subject, grade].filter(Boolean).join(' '),
        topics: topics,
        topicsLower: joinList(topics.map(function (t) { return t.toLowerCase(); }), ' và '),
        topicsTitle: joinList(topics.map(cap), ' & '),
        subtitle: total + ' câu hỏi' + (topics.length ? ' \u00A0·\u00A0 ' + joinList(topics.map(cap), ' & ') : ''),
        intro: 'Luyện tập ' + (topics.length ? joinList(topics.map(function (t) { return t.toLowerCase(); }), ' và ') + ' ' : '') +
               'với ' + total + ' câu hỏi được biên soạn kỹ lưỡng.',
        minutes: minutes,
        randomCount: randomCount,
        randomMinutes: Math.max(1, Math.round(minutes * randomCount / total)),
        pickMax: pickMax,
        total: total,
        sectionCount: sectionsUsed.length,
        sections: sections,
        sectionById: sectionById,
        questions: questions
      }
    };
  }

  /* ---------- nạp đề ---------- */
  function load() {
    return new Promise(function (resolve, reject) {
      var done = false, iframe = null, timer = null;

      function finish(fn, value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        global.removeEventListener('message', onMessage);
        if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
        fn(value);
      }

      function onMessage(ev) {
        if (!iframe || ev.source !== iframe.contentWindow) return;
        var d = ev.data;
        if (!d || typeof d !== 'object') return;
        if (d.type === 'exam-data') {
          var r = normalize(d.exam);
          if (r.errors.length) finish(reject, makeError(r.errors));
          else finish(resolve, r.exam);
        } else if (d.type === 'exam-error') {
          finish(reject, makeError([String(d.message || 'File đề báo lỗi.')]));
        }
      }

      global.addEventListener('message', onMessage);

      iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.tabIndex = -1;
      iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
      iframe.addEventListener('load', function () {
        try { iframe.contentWindow.postMessage({ type: 'exam-request' }, '*'); } catch (e) { /* bỏ qua */ }
      });
      // ?t=... để luôn lấy bản đề mới nhất, không bị trình duyệt giữ bản cũ
      iframe.src = encodeURI(EXAM_FILE) + '?t=' + Date.now();

      timer = setTimeout(function () {
        finish(reject, makeError([
          'Không nhận được dữ liệu từ file "' + EXAM_FILE + '".',
          'Hãy kiểm tra file có nằm cùng thư mục với các trang khác không, rồi mở thẳng file đó lên để xem báo lỗi.'
        ]));
      }, TIMEOUT_MS);

      document.body.appendChild(iframe);
    });
  }

  /* ---------- hiện lỗi toàn màn hình ---------- */
  function fail(err) {
    var messages = err && err.messages ? err.messages : [String((err && err.message) || err)];
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#0b0c0e;color:#f0ede6;' +
      'display:flex;align-items:center;justify-content:center;padding:24px;font-family:system-ui,sans-serif;line-height:1.6';
    var inner = document.createElement('div');
    inner.style.cssText = 'max-width:560px;width:100%';
    var h = document.createElement('h2');
    h.textContent = '⚠️ Không tải được đề';
    h.style.cssText = 'margin-bottom:12px;font-size:1.4rem';
    var ul = document.createElement('ul');
    ul.style.cssText = 'padding-left:20px;margin-bottom:16px;color:#f0b4ac';
    messages.forEach(function (m) { var li = document.createElement('li'); li.textContent = m; ul.appendChild(li); });
    var p = document.createElement('p');
    p.textContent = 'Sửa file "' + EXAM_FILE + '" rồi tải lại trang.';
    p.style.color = '#9b988f';
    inner.appendChild(h); inner.appendChild(ul); inner.appendChild(p);
    box.appendChild(inner);
    document.body.appendChild(box);
    if (global.console) console.error('[exam-loader]', messages.join(' | '));
  }

  /* ---------- điền số liệu vào các phần tử có data-fill="..." ---------- */
  function fill(exam, root) {
    var vals = {
      subject: exam.subject, eyebrow: exam.eyebrow,
      topicsLower: exam.topicsLower, topicsTitle: exam.topicsTitle, intro: exam.intro, subtitle: exam.subtitle,
      total: exam.total, sections: exam.sectionCount, minutes: exam.minutes,
      randomCount: exam.randomCount, randomMinutes: exam.randomMinutes, pickMax: exam.pickMax
    };
    var nodes = (root || document).querySelectorAll('[data-fill]');
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-fill');
      if (Object.prototype.hasOwnProperty.call(vals, key)) nodes[i].textContent = vals[key];
    }
  }

  global.ExamLoader = {
    EXAM_FILE: EXAM_FILE,
    LETTERS: LETTERS,
    normalize: normalize,
    load: load,
    fail: fail,
    fill: fill
  };
})(window);
