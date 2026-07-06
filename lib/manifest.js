(function () {
  "use strict";

  window.__BRAND__ = {
    name: "Salinas JRS",
    shortName: "SJRS",
    tagline: "Multimarca. Sin vueltas.",
    kicker: "Indumentaria multimarca · Florencio Varela",

    contact: {
      whatsapp: "5491167595053",
      whatsappDisplay: "+54 9 11 6759-5053",
      instagram: "saliasjrs",
      instagramUrl: "https://instagram.com/saliasjrs",
      hoursText: "Lunes a sábado · 09:00 a 20:30",
      addressText: "Bernardo Monteagudo 214, Florencio Varela, Buenos Aires",
      mapEmbedSrc: "https://www.google.com/maps/embed?origin=mfe&pb=!1m2!2m1!1sBernardo+Monteagudo+214%2C+Florencio+Varela%2C+Buenos+Aires%2C+Argentina"
    },

    // Google Sheets — leído en vivo vía endpoint público gviz (JSONP, sin backend)
    sheet: {
      id: "1Ed2aE3Q_ARMcSQng804pq7l99rCAnxJuc4-7M1JkYA4",
      // Endpoint JSONP: no requiere CORS porque se carga como <script>, no fetch()
      endpoint: function (callbackName) {
        return "https://docs.google.com/spreadsheets/d/" + this.id +
          "/gviz/tq?tqx=out:json;responseHandler:" + callbackName;
      }
    },

    // Pago con tarjeta (Mercado Pago) vía función serverless externa (Vercel).
    // Reemplazá esta URL por la que te da Vercel al desplegar salinas-jrs-pagos.
    payments: {
      createPreferenceUrl: "https://TU-PROYECTO.vercel.app/api/create-preference"
    },

    categoryLabels: {
      buzos: "Buzos",
      jeans: "Jeans",
      remeras: "Remeras",
      camperas: "Camperas",
      camisas: "Camisas",
      shorts: "Shorts",
      calzado: "Calzado",
      accesorios: "Accesorios"
    },

    // Fallback — se usa SOLO si el Sheet no responde (offline, bloqueado, etc.)
    fallbackProducts: [
      { nombre: "Buzo mistral liso", precio: 100000, talles: "S,M,L,XL,XXL", categoria: "buzos", imagen: "", imagen2: "", activo: "SI" },
      { nombre: "Levis 568", precio: 200000, talles: "28 30, 28 32, 30 30, 30 32, 30 34, 31 30, 31 32, 32 30", categoria: "jeans", imagen: "", imagen2: "", activo: "SI" },
      { nombre: "Levis 501", precio: 200000, talles: "28 30, 28 32, 30 30, 30 32, 30 34, 31 30, 31 32, 32 30", categoria: "jeans", imagen: "", imagen2: "", activo: "SI" },
      { nombre: "Remera rusty brown", precio: 40000, talles: "S,M,L,XL,XXL", categoria: "remeras", imagen: "", imagen2: "", activo: "SI" }
    ]
  };
})();
