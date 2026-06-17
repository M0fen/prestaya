// Saludo personalizado al cliente.

export function Saludo({ nombre }: { nombre: string }) {
  return (
    <div className="-mt-1 flex flex-col gap-0.5">
      <span className="text-[14px] font-medium text-gris">Hola,</span>
      <h1 className="m-0 text-[25px] font-extrabold tracking-[-0.03em] text-tinta">
        {nombre}
      </h1>
      <span className="mt-0.5 text-[13.5px] font-medium text-gris">
        Acá podés ver cómo vas con tu crédito.
      </span>
    </div>
  );
}
