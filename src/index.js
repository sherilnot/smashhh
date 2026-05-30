const express = require('express')
const path = require('path')
require('dotenv').config()

const app = express()

// View engine
app.set('view engine', 'ejs')
app.set('views', path.join(__dirname, 'views'))

// Static files
app.use(express.static(path.join(__dirname, 'public')))

// Routes
app.use('/', require('./routes/index'))
app.use('/categories', require('./routes/categories'))
app.use('/products', require('./routes/products'))

// 404
app.use((req, res) => {
  res.status(404).render('404')
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`)
})
