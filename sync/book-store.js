// Keep the encrypted book and its reset generation in the same SQLite transaction.
export function bookStore(storage) {
  const sql=storage.sql;
  sql.exec('CREATE TABLE IF NOT EXISTS book (id INTEGER PRIMARY KEY, rev INTEGER NOT NULL, data TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS book_generation (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)');
  const generation=()=>sql.exec('SELECT value FROM book_generation WHERE id=1').toArray()[0]?.value||0;
  return {
    read(since) {
      const revision=sql.exec('SELECT rev FROM book WHERE id=1').toArray()[0]?.rev||0;
      return {revision,generation:generation(),...(revision&&since!==revision?{blob:sql.exec('SELECT data FROM book WHERE id=1').one().data}:{})};
    },
    write(revision,blob,expectedGeneration,replace=false) {
      return storage.transactionSync(()=>{
        const current=sql.exec('SELECT rev FROM book WHERE id=1').toArray()[0]?.rev||0,oldGeneration=generation();
        if(current!==revision||expectedGeneration!==oldGeneration)return null;
        const nextGeneration=oldGeneration+(replace?1:0);
        sql.exec('INSERT OR REPLACE INTO book(id,rev,data) VALUES(1,?,?)',current+1,blob);
        sql.exec('INSERT OR REPLACE INTO book_generation(id,value) VALUES(1,?)',nextGeneration);
        return {revision:current+1,generation:nextGeneration};
      });
    }
  };
}
