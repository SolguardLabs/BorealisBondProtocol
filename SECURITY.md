# Política de seguridad

## Versiones mantenidas

| Versión | Estado            | Referencia                            |
| ------- | ----------------- | ------------------------------------- |
| 1.0.x   | Mantenida         | Rama `production` y etiqueta `v1.0.0` |
| < 1.0   | Sin mantenimiento | No recibe correcciones                |

La rama `main` contiene el estado integrado. Una entrega solo se considera publicada cuando
`main`, `production`, la etiqueta anotada y el release han superado sus controles independientes.

## Principios del sistema

BorealisBondProtocol protege cuatro propiedades: autorización, conservación contable, ejecución
predecible y trazabilidad. Los siguientes invariantes deben mantenerse en toda transición:

```text
0 <= soldReserve <= capacityReserve
0 <= soldPayout  <= capacityPayout
0 <= claimed     <= vested <= payoutTotal
discountedPrice > 0
ledger debits == ledger credits
executed change => approvalWeight >= approvalQuorum
```

Las cantidades monetarias nunca usan coma flotante. Las conversiones entre activos ocurren con
factores decimales explícitos y las divisiones usan una dirección de redondeo definida. Las
cotizaciones se vinculan al comprador, importe, mercado, caducidad e índice de precio.

## Superficie protegida

- Alta y estado de mercados de bonos.
- Curvas de descuento, normalización decimal y límites de deslizamiento.
- Apertura, vesting, reclamación, cancelación y cierre de posiciones.
- Saldos de reserva, inventario de emisión, pasivos y asientos del ledger.
- Actualizaciones de precio y coherencia de cotizaciones pendientes.
- Conciliación de posición, activo y mercado.
- Evaluación de liquidez, haircuts, concentración y cobertura.
- Firmas Ed25519, nonces, quórums, ventanas temporales y dependencias de cambios.
- Cliente HTTP, validación de respuestas, timeout e idempotencia.
- Cadena de entrega, ramas protegidas, etiqueta anotada e integridad del release.

## Modelo de confianza

Los compradores solo pueden operar sus posiciones. Keepers actualizan observaciones de mercado;
su rol no concede movimiento directo de reservas. Operaciones puede pausar mercados y coordinar la
conciliación. Los cambios sensibles requieren proponente autorizado, firma válida, nonce no usado,
quórum ponderado y espera temporal. Auditoría conserva capacidad de revisión y cancelación sin
convertirse en una ruta de ejecución unilateral.

Las claves privadas, tokens de acceso y secretos de integración no pertenecen al repositorio. El
SDK acepta credenciales en memoria y no registra cabeceras de autorización ni cuerpos completos.

## Comunicación privada

Use **GitHub Security Advisories → New draft advisory** en este repositorio. No abra una incidencia
pública con detalles técnicos. El informe debe incluir:

1. Componente, versión y precondiciones.
2. Secuencia mínima y determinista para reproducir el comportamiento.
3. Activos, roles y transiciones de estado implicados.
4. Impacto máximo razonable y límites observados.
5. Evidencia reproducible, sin credenciales ni datos de terceros.
6. Propuesta de corrección o invariante que debería reforzarse.

Acusaremos recibo en un máximo de tres días laborables. La clasificación inicial se comunicará
en siete días laborables y las actualizaciones relevantes se enviarán al menos cada catorce días.
La publicación coordinada se acuerda una vez disponible una versión corregida.

## Expectativas de investigación

- Use cuentas y entornos bajo su control.
- Limite el volumen al mínimo necesario para demostrar el comportamiento.
- No interrumpa servicios, cadenas de entrega ni disponibilidad de terceros.
- No acceda, retenga o comparta información ajena.
- Detenga la actividad si aparece riesgo de afectar activos externos.
- Conserve hashes, versiones, marcas temporales y entradas exactas.

La investigación de buena fe que respete estas condiciones recibirá una respuesta coordinada. Esta
política no autoriza actividad fuera de los sistemas controlados por la organización.

## Respuesta y recuperación

Una alerta financiera activa el flujo documentado en [docs/runbooks.md](./docs/runbooks.md):
contención, captura de estado, conciliación, clasificación, cambio firmado, verificación y
reanudación gradual. Ningún operador debe corregir manualmente saldos sin un artefacto auditable y
una aprobación acorde al control de cambios.

## Integridad de dependencias y entrega

- Las versiones de herramientas están fijadas en `package.json` y `bun.lock`.
- CI instala con `bun install --frozen-lockfile`.
- CODEOWNERS exige revisión sobre gobierno, riesgo, documentación y workflows.
- La etiqueta de versión debe ser anotada y coincidir con el campo `version`.
- La etiqueta debe resolver al mismo SHA que `origin/production`.
- El control completo vuelve a ejecutarse tanto al crear la etiqueta como al publicar el release.
