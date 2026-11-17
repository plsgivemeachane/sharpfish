/* Background grading shares the review policy and never occupies the playing engine. */
(function (root) {
  "use strict";
  var specialMoves = true, enabled = false, current = null, analyzer = null, running = null, epoch = 0, failed = {};
  function remember(value) { try { root.localStorage.setItem("sharpfish-live-grading", value ? "1" : "0"); } catch (_) {} }
  function status(text) { if (root.SFAppHooks && root.SFAppHooks.onGradeStatus) root.SFAppHooks.onGradeStatus(text); }
  function valid(grade, record, index) {
    return root.SFAnalysis && root.SFAnalysis.isValidGrade(grade, record, index, root.STOCK_ENGINE_FILE, specialMoves);
  }
  function interrupt() {
    epoch++;
    if (analyzer) analyzer.dispose();
    analyzer = null; running = null;
  }
  function drain() {
    if (running || !enabled || !current || current.variant && current.variant.supported === false || !root.SFAnalysis) return;
    var record = current;
    var index = record.moves.length - 1;
    while (index >= 0 && (failed[index] || valid(record.grades && record.grades[index], record, index))) index--;
    if (index < 0) { status(Object.keys(failed).length ? "Some moves need another analysis attempt. Toggle grading to retry." : "Moves graded"); return; }
    if (!analyzer) analyzer = new root.SFAnalysis.Analyzer(root.STOCK_ENGINE_FILE);
    var job = { epoch: epoch, id: record.id, index: index, key: root.SFAnalysis.historyKey(record, index + 1) };
    running = job; status("Grading move " + (index + 1) + "…");
    analyzer.grade(record, index, { specialMoves: specialMoves }).then(async function (grade) {
      if (!enabled || epoch !== job.epoch || !current || current.id !== job.id || root.SFAnalysis.historyKey(current, index + 1) !== job.key) return;
      current.grades = current.grades || {}; current.grades[index] = grade;
      var patch = {}; patch[index] = grade;
      try { await root.SFHistory.updateGrades(current.id, current.revision, patch); }
      catch (_) { status("Grade ready; local saving failed."); }
      if (epoch === job.epoch && current && current.id === job.id && root.SFAnalysis.historyKey(current, index + 1) === job.key && root.SFAppHooks && root.SFAppHooks.setGrade) {
        root.SFAppHooks.setGrade(index, grade, current.id, current.revision);
      }
    }).catch(function (error) {
      if (job.epoch !== epoch || error.name === "AbortError") return;
      failed[index] = true;
      if (root.SFAppHooks && root.SFAppHooks.onGradeError) root.SFAppHooks.onGradeError(error);
    }).then(function () { if (running === job) { running = null; drain(); } });
  }
  function schedule(record) {
    if (!record || !record.id) return;
    if (current && current.id === record.id && current.revision > record.revision) return;
    if (current && current.id !== record.id) { interrupt(); failed = {}; }
    if (current && current.id === record.id) {
      record.grades = Object.assign({}, record.grades || {});
      Object.keys(current.grades || {}).forEach(function (i) { if (valid(current.grades[i], record, +i)) record.grades[i] = current.grades[i]; });
    }
    current = record; drain();
  }
  root.SFLive = {
    init: function () { try { enabled = root.localStorage.getItem("sharpfish-live-grading") === "1"; specialMoves = root.localStorage.getItem("sharpfish-special-grading") !== "0"; } catch (_) {} return enabled; },
    enabled: function () { return enabled; },
    specialMoves: function () { return specialMoves; },
    setSpecialMoves: function (value) { specialMoves = !!value; try { root.localStorage.setItem("sharpfish-special-grading", specialMoves ? "1" : "0"); } catch (_) {} interrupt(); failed = {}; drain(); },
    toggle: function (value) { enabled = !!value; remember(enabled); failed = {}; if (!enabled) { interrupt(); status(""); } else drain(); return enabled; },
    schedule: schedule,
    cancel: function () { interrupt(); current = null; failed = {}; status(""); }
  };
})(typeof self === "object" ? self : window);
