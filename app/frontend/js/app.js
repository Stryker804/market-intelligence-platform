/* Bootstrap */

window.MIPCore.boot().catch((e) => {
  document.getElementById("page").innerHTML =
    '<div class="error-banner">Ошибка запуска: ' + window.MIPFormatters.escapeHtml(e.message) + "</div>";
});