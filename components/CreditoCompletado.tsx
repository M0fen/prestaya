// Celebración de cierre: el cliente terminó de pagar su crédito. Momento
// emocional positivo (refuerza la identidad de buen pagador → vuelve a pedir).
export function CreditoCompletado() {
  return (
    <section className="relative overflow-hidden rounded-[22px] bg-[linear-gradient(135deg,#1FA971,#157A50)] px-5 py-6 text-center text-white shadow-[0_14px_30px_rgba(31,169,113,0.32)]">
      <div className="pointer-events-none absolute -top-[50px] -right-[40px] h-[150px] w-[150px] rounded-full bg-white/[0.1]" />
      <div className="pointer-events-none absolute -bottom-[60px] -left-[30px] h-[150px] w-[150px] rounded-full bg-white/[0.08]" />
      <div className="relative flex flex-col items-center gap-1.5">
        <span className="text-[40px] leading-none" aria-hidden="true">
          🎉
        </span>
        <h2 className="m-0 text-[22px] font-black tracking-[-0.02em]">
          ¡Completaste tu crédito!
        </h2>
        <p className="m-0 max-w-[280px] text-[13.5px] leading-[1.45] font-medium text-white/[0.9]">
          Pagaste todo. Gracias por tu compromiso — sos un cliente de confianza.
        </p>
      </div>
    </section>
  );
}
