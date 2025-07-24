import { Child } from './Child'

function App() {
  const array = [1, 2, 3]

  const test = { array }

  function onClick() {
    console.log('clicked')
  }

  return (
    <div className="App">
      <Child test={test} onClick={onClick} />
    </div>
  )
}

export default App
