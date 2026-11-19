/**
 * Development only, loaded when VITE_DEV_WALLET names the mock provider: a WebLN wallet of play
 * money that "pays" an invoice by telling the mock it was paid. The app sees an ordinary WebLN
 * provider. `luft:devwallet` = `off` in localStorage leaves the browser without a wallet.
 */
export function install(mock: string) {
  if (localStorage.getItem("luft:devwallet") === "off") return;
  window.webln ??= {
    enable: async () => {},
    async sendPayment(invoice) {
      const paid = await fetch(`${mock}/pay`, {
        method: "POST",
        body: JSON.stringify({ invoice }),
      });
      if (!paid.ok) throw new Error("The dev wallet only pays the mock provider's invoices.");
      return paid.json();
    },
  };
}
