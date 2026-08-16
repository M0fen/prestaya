' Lanzador INVISIBLE del respaldo incremental (Task Scheduler abria una consola
' cada corrida — molesto a cada rato en el escritorio de Carlos, 16-08).
' Corre el script con la ventana OCULTA (flag 0) y guarda la salida en
' respaldos-libro\registro.log para no perder el rastro de cada corrida.
Set sh = CreateObject("WScript.Shell")
sh.Run "cmd /c cd /d C:\Users\Carlos\Desktop\prestaya && node --env-file=.env.local scripts\respaldo-libro.mjs >> respaldos-libro\registro.log 2>&1", 0, False
