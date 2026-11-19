/* Background grading shares the review policy and never occupies the playing engine. */
(function (root) {
  "use strict";
  var specialMoves = true, enabled = false, current = null, analyzer = null, running = null, epoch = 0, failed = {};
  function remember(value) { try { root.localStorage.setItem("sharpfish-live-grading", value ? "1" : "0"); } catch (_) {} }
  function status(text) { if (root.SFAppHooks && root.SFAppHooks.onGradeStatus) root.SFAppHooks.onGradeStatus(text); }
  function valid(grade, record, index) {
    var atomic = !!(record && record.variant && record.variant.slug === "atomic");
    var engine = root.SFAnalysis && root.SFAnalysis.engineForRecord ? root.SFAnalysis.engineForRecord(record, root) : root.STOCK_ENGINE_FILE;
    return !!(root.SFAnalysis && engine && root.SFAnalysis.isValidGrade(grade, record, index, engine, atomic ? false : specialMoves));
  }
  function interrupt() {
    epoch++;
    if (analyzer) analyzer.dispose();
    analyzer = null; running = null;
  }
  function drain() {
    var atomic = !!(current && current.variant && current.variant.slug === "atomic");
    var engine = root.SFAnalysis && root.SFAnalysis.engineForRecord ? root.SFAnalysis.engineForRecord(current, root) : root.STOCK_ENGINE_FILE;
    if (running || !enabled || !current || !root.SFAnalysis || !engine || !root.SFAnalysis.supportsRecord(current)) return;
    var record = current;
    var index = -1, retry = -1, unavailable = 0;
    for (var i = record.moves.length - 1; i >= 0; i--) {
      if (valid(record.grades && record.grades[i], record, i)) continue;
      var attempts = failed[root.SFAnalysis.historyKey(record, i + 1)] || 0;
      if (!attempts) { index = i; break; }
      if (attempts < 2 && retry < 0) retry = i;
      else if (attempts >= 2) unavailable++;
    }
    if (index < 0) index = retry;
    if (index < 0) {
      var incompatible = Object.keys(record.grades || {}).filter(function (i) { return valid(record.grades[i], record, +i) && record.grades[i].unavailable; }).length;
      status(unavailable ? unavailable + (unavailable === 1 ? " move" : " moves") + " could not be graded after retrying. Toggle grading to retry." : incompatible ? "Moves graded; " + incompatible + " unavailable in ordinary chess." : "Moves graded"); return;
    }
    if (!analyzer) analyzer = new root.SFAnalysis.Analyzer(engine, { atomic: atomic });
    var job = { epoch: epoch, id: record.id, index: index, key: root.SFAnalysis.historyKey(record, index + 1) };
    running = job; status((failed[job.key] ? "Retrying move " : "Grading move ") + (index + 1) + "…");
    analyzer.grade(record, index, { specialMoves: atomic ? false : specialMoves }).then(async function (grade) {
      if (!enabled || epoch !== job.epoch || !current || current.id !== job.id || root.SFAnalysis.historyKey(current, index + 1) !== job.key) return;
      current.grades = current.grades || {}; current.grades[index] = grade;
      delete failed[job.key];
      var patch = {}; patch[index] = grade;
      try { await root.SFHistory.updateGrades(current.id, current.revision, patch); }
      catch (_) { status("Grade ready; local saving failed."); }
      if (epoch === job.epoch && current && current.id === job.id && root.SFAnalysis.historyKey(current, index + 1) === job.key && root.SFAppHooks && root.SFAppHooks.setGrade) {
        root.SFAppHooks.setGrade(index, grade, current.id, current.revision);
      }
    }).catch(function (error) {
      if (job.epoch !== epoch) return;
      failed[job.key] = (failed[job.key] || 0) + 1;
      if (analyzer) analyzer.dispose();
      analyzer = null;
      if (failed[job.key] >= 2 && root.SFAppHooks && root.SFAppHooks.onGradeError) root.SFAppHooks.onGradeError(error);
    }).then(function () { if (running === job) { running = null; drain(); } });
  }
  function schedule(record) {
    if (!record || !record.id) return;
    if (current && current.id === record.id && current.revision > record.revision) return;
    if (current && current.id !== record.id) { interrupt(); failed = {}; }
    var carried = {};
    if (current && current.id === record.id) {
      record.grades = Object.assign({}, record.grades || {});
      Object.keys(current.grades || {}).forEach(function (i) {
        if (!valid(record.grades[i], record, +i) && valid(current.grades[i], record, +i)) carried[i] = record.grades[i] = current.grades[i];
      });
    }
    current = record;
    var carriedIndices = Object.keys(carried);
    // A newer move can be saved before the previous grade's write completes.
    // Deliver retained grades to that revision too, or the UI stays blank even
    // though drain correctly sees a completed grade in its own copy.
    carriedIndices.forEach(function (i) {
      if (root.SFAppHooks && root.SFAppHooks.setGrade) root.SFAppHooks.setGrade(+i, carried[i], record.id, record.revision);
    });
    if (carriedIndices.length) root.SFHistory.updateGrades(record.id, record.revision, carried).catch(function () { status("Grade ready; local saving failed."); });
    drain();
  }
  root.SFLive = {
    init: function () { try { enabled = root.localStorage.getItem("sharpfish-live-grading") === "1"; specialMoves = root.localStorage.getItem("sharpfish-special-grading") !== "0"; } catch (_) {} return enabled; },
    enabled: function () { return enabled; },
    specialMoves: function () { return (root.SHARPFISH_VARIANT || {}).slug === "atomic" || current && current.variant && current.variant.slug === "atomic" ? false : specialMoves; },
    setSpecialMoves: function (value) { specialMoves = !!value; try { root.localStorage.setItem("sharpfish-special-grading", specialMoves ? "1" : "0"); } catch (_) {} interrupt(); failed = {}; drain(); },
    toggle: function (value) { enabled = !!value; remember(enabled); failed = {}; if (!enabled) { interrupt(); status(""); } else drain(); return enabled; },
    schedule: schedule,
    cancel: function () { interrupt(); current = null; failed = {}; status(""); }
  };
})(typeof self === "object" ? self : window);
