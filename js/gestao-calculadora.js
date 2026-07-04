/**
 * gestao.html — calculadora de lucro (#sec-calculadora-widget)
 * Máscara de moeda BRL nos inputs + cálculo ao vivo de lucro bruto,
 * lucro líquido e margem.
 */
(function () {
  "use strict";

  var section = document.getElementById("sec-calculadora-widget");
  if (!section) return;

  var inputs = section.querySelectorAll("input[data-calc]");
  var resultLucroBruto = section.querySelector('[data-calc-result="lucro-bruto"]');
  var resultLucroLiquido = section.querySelector('[data-calc-result="lucro-liquido"]');
  var resultMargem = section.querySelector('[data-calc-result="margem"]');

  function centsFromDigits(digits) {
    return digits ? parseInt(digits, 10) : 0;
  }

  function formatCents(cents) {
    var value = (cents / 100).toFixed(2);
    var parts = value.split(".");
    var intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return intPart + "," + parts[1];
  }

  function formatBRL(cents) {
    var sign = cents < 0 ? "-" : "";
    return sign + "R$ " + formatCents(Math.abs(cents));
  }

  function getCents(input) {
    var digits = (input.value || "").replace(/\D/g, "");
    return centsFromDigits(digits);
  }

  function maskInput(input) {
    var digits = (input.value || "").replace(/\D/g, "");
    input.value = formatCents(centsFromDigits(digits));
  }

  function recalc() {
    var faturamento = 0;
    var custos = 0;
    var despesas = 0;

    inputs.forEach(function (input) {
      var cents = getCents(input);
      var field = input.getAttribute("data-calc");
      if (field === "faturamento") {
        faturamento += cents;
      } else if (field.indexOf("custo-") === 0) {
        custos += cents;
      } else if (field.indexOf("despesa-") === 0) {
        despesas += cents;
      }
    });

    var lucroBruto = faturamento - custos;
    var lucroLiquido = lucroBruto - despesas;
    var margem = faturamento > 0 ? (lucroLiquido / faturamento) * 100 : 0;

    if (resultLucroBruto) resultLucroBruto.textContent = formatBRL(lucroBruto);
    if (resultLucroLiquido) resultLucroLiquido.textContent = formatBRL(lucroLiquido);
    if (resultMargem) resultMargem.textContent = margem.toFixed(1).replace(".", ",") + "%";
  }

  inputs.forEach(function (input) {
    input.addEventListener("input", function () {
      maskInput(input);
      recalc();
    });
    input.addEventListener("focus", function () {
      if (getCents(input) === 0) input.select();
    });
  });

  recalc();
})();
