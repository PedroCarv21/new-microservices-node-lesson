// Uma função simples para 'dormir' por um X milissegundos
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Tenta executar uma função assíncrona com múltiplas tentativas e backoff exponencial.
   * @param {Function} fn A função assíncrona a ser executada.
   * @param {number} retries Número máximo de tentativas.
   * @param {number} initialDelay Tempo de espera inicial em ms.
   * @param {string} operationName Um nome para o log (ex: "AMQP-Connection").
   */
  export async function retryWithBackoff(fn, retries = 5, initialDelay = 2000, operationName = 'operation') {
    let attempt = 1;
    let delay = initialDelay;
  
    while (attempt <= retries) {
      try {
        console.log(`[${operationName}] Tentativa ${attempt} de ${retries}...`);
        const result = await fn(); // Tenta executar a função
        console.log(`[${operationName}] Sucesso na tentativa ${attempt}.`);
        return result; // Sucesso, retorna o resultado
      } catch (err) {
        console.warn(`[${operationName}] Tentativa ${attempt} falhou: ${err.message}`);
        
        if (attempt === retries) {
          console.error(`[${operationName}] Todas as ${retries} tentativas falharam.`);
          throw err; // Desiste e lança o último erro
        }
  
        // Adiciona um "jitter" (variação aleatória) para evitar que todos os serviços tentem ao mesmo tempo
        const jitter = Math.random() * 1000;
        const waitTime = delay + jitter;
        console.log(`[${operationName}] Próxima tentativa em ${Math.round(waitTime / 1000)}s...`);
        
        await sleep(waitTime);
        
        delay *= 2; // Dobra o tempo de espera (backoff exponencial)
        attempt++;
      }
    }
  }