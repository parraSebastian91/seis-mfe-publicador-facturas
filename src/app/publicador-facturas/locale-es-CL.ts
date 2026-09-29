/**
 * Datos de locale es-CL, copiados verbatim de
 * `node_modules/@angular/common/locales/es-CL.js` (Angular 19.2.18, licencia MIT
 * de Google LLC — https://angular.dev/license).
 *
 * POR QUÉ ESTÁN ACÁ Y NO SE IMPORTAN
 * `import localeEsCl from '@angular/common/locales/es-CL'` deja un bare
 * specifier que **ningún import map del sistema resuelve**: native-federation
 * no puede compartir ese entrypoint —es un archivo suelto, no un directorio con
 * package.json, y el intento da "No entry point found"— y ponerlo en `skip`
 * tampoco lo saca de los externals (skip solo quita entradas de `shared`).
 *
 * El resultado era que el MFE **no cargaba**, ni con `ng serve` standalone ni
 * con el build de producción, con:
 *   ERROR Error: Unable to resolve specifier '@angular/common/locales/es-CL'
 * Verificado sobre `dist/` y contra los 5 remoteEntry.json: ninguno lo declara.
 *
 * Al ser un módulo propio con import relativo, esto se empaqueta dentro del MFE
 * y el specifier desaparece.
 *
 * MANTENIMIENTO: si se actualiza Angular y cambian los datos de es-CL, hay que
 * regenerar este archivo desde `node_modules/@angular/common/locales/es-CL.js`.
 * Los datos de locale de CLDR se mueven muy poco, pero queda anotado en el todo.
 */
/* eslint-disable */
// THIS CODE IS GENERATED - DO NOT MODIFY.
const u: undefined = undefined;
function plural(val: number): number {
    const n = val, i = Math.floor(Math.abs(val)), v = val.toString().replace(/^[^.]*\.?/, '').length, e = parseInt(val.toString().replace(/^[^e]*(e([-+]?\d+))?/, '$2')) || 0;
    if (n === 1)
        return 1;
    if (e === 0 && (!(i === 0) && (i % 1000000 === 0 && v === 0)) || !(e >= 0 && e <= 5))
        return 4;
    return 5;
}
const localeEsCL: unknown[] = ["es-CL", [["a. m.", "p. m."], u, u], u, [["d", "l", "m", "m", "j", "v", "s"], ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"], ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"], ["do", "lu", "ma", "mi", "ju", "vi", "sá"]], [["D", "L", "M", "M", "J", "V", "S"], ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"], ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"], ["DO", "LU", "MA", "MI", "JU", "VI", "SA"]], [["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"], ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"], ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]], [["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"], ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sept.", "oct.", "nov.", "dic."], ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]], [["a. C.", "d. C."], u, ["antes de Cristo", "después de Cristo"]], 1, [6, 0], ["dd-MM-yy", "dd-MM-y", "d 'de' MMMM 'de' y", "EEEE, d 'de' MMMM 'de' y"], ["HH:mm", "HH:mm:ss", "HH:mm:ss z", "HH:mm:ss zzzz"], ["{1}, {0}", "{1} {0}", "{1}, {0}", u], [",", ".", ";", "%", "+", "-", "E", "×", "‰", "∞", "NaN", ":"], ["#,##0.###", "#,##0 %", "¤#,##0.00;¤-#,##0.00", "#E0"], "CLP", "$", "Peso chileno", { "AUD": [u, "$"], "BRL": [u, "R$"], "BYN": [u, "р."], "CAD": [u, "$"], "CLP": ["$"], "CNY": [u, "¥"], "ESP": ["₧"], "EUR": [u, "€"], "FKP": [u, "FK£"], "GBP": [u, "£"], "HKD": [u, "$"], "ILS": [u, "₪"], "INR": [u, "₹"], "JPY": [u, "¥"], "KRW": [u, "₩"], "MXN": [u, "$"], "NZD": [u, "$"], "PHP": [u, "₱"], "RON": [u, "L"], "SSP": [u, "SD£"], "SYP": [u, "S£"], "TWD": [u, "NT$"], "USD": ["US$", "$"], "VEF": [u, "BsF"], "VND": [u, "₫"], "XAF": [], "XCD": [u, "$"], "XOF": [] }, "ltr", plural];

export default localeEsCL;
