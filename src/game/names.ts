/**
 * Noms des pilotes et immatriculations des avions.
 */
import { pick, randInt, type Rng } from './rng';

// ───────────────────────── Prénoms et noms par région ─────────────────────────

interface NamePool {
  first: string[];
  last: string[];
}

const POOLS: Record<string, NamePool> = {
  fr: {
    first: ['Camille', 'Léa', 'Manon', 'Chloé', 'Inès', 'Sarah', 'Julie', 'Claire', 'Emma', 'Louise', 'Lucas', 'Hugo', 'Louis', 'Thomas', 'Nathan', 'Julien', 'Antoine', 'Maxime', 'Gabriel', 'Mathis', 'Yanis', 'Karim', 'Amina', 'Élodie', 'Nicolas', 'Pauline', 'Alice', 'Jade', 'Zoé', 'Lina', 'Rose', 'Anna', 'Ambre', 'Juliette', 'Margaux', 'Agathe', 'Mathilde', 'Charlotte', 'Lou', 'Eva', 'Romane', 'Clara', 'Océane', 'Lucie', 'Noémie', 'Justine', 'Mélanie', 'Aurélie', 'Sophie', 'Nathalie', 'Céline', 'Isabelle', 'Sandrine', 'Gwenaëlle', 'Maëlys', 'Nina', 'Victoire', 'Adèle', 'Héloïse', 'Capucine', 'Léon', 'Arthur', 'Jules', 'Raphaël', 'Paul', 'Adam', 'Noah', 'Sacha', 'Victor', 'Théo', 'Ethan', 'Tom', 'Timothée', 'Baptiste', 'Clément', 'Alexandre', 'Romain', 'Quentin', 'Benjamin', 'Florian', 'Kevin', 'Mehdi', 'Sofiane', 'Olivier', 'Pierre', 'François', 'Sébastien', 'Guillaume', 'Vincent', 'Jérôme', 'Loïc', 'Yann', 'Erwan', 'Gaël', 'Tristan', 'Matthieu', 'Cédric', 'Damien', 'Aurélien', 'Bastien', 'Corentin', 'Valentin', 'Axel', 'Enzo', 'Malo', 'Gwenaël', 'Ronan', 'Killian', 'Elias', 'Marius', 'Samuel', 'Simon', 'Lilou', 'Inaya', 'Salomé'],
    last: ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'Andre', 'Mercier', 'Blanc', 'Guerin', 'Boyer', 'Garnier', 'Chevalier', 'Le Gall', 'Lambert', 'Bonnet', 'François', 'Martinez', 'Legrand', 'Faure', 'Rousseau', 'Muller', 'Henry', 'Roussel', 'Nicolas', 'Perrin', 'Morin', 'Mathieu', 'Clement', 'Gauthier', 'Dumont', 'Lopez', 'Fontaine', 'Robin', 'Masson', 'Sanchez', 'Gerard', 'Nguyen', 'Denis', 'Lemaire', 'Duval', 'Joly', 'Gautier', 'Roger', 'Roche', 'Roy', 'Noel', 'Meyer', 'Lucas', 'Meunier', 'Jean', 'Perez', 'Marchand', 'Dufour', 'Blanchard', 'Marie', 'Barbier', 'Brun', 'Dumas', 'Brunet', 'Schmitt', 'Leroux', 'Colin', 'Fernandez', 'Pierre', 'Renard', 'Arnaud', 'Rolland', 'Caron', 'Aubert', 'Giraud', 'Leclerc', 'Vidal', 'Bourgeois', 'Renaud', 'Lemoine', 'Picard', 'Gaillard', 'Philippe', 'Leclercq', 'Lacroix', 'Fabre', 'Dupuis', 'Olivier', 'Rodriguez', 'Da Silva', 'Hubert', 'Louis', 'Charles', 'Guillot', 'Riviere', 'Guillou', 'Le Goff', 'Kerbrat', 'Le Bihan', 'Tanguy', 'Cariou', 'Morvan'],
  },
  en: {
    first: ['Olivia', 'Emily', 'Sophie', 'Grace', 'Hannah', 'Megan', 'Jessica', 'Lauren', 'James', 'Oliver', 'Jack', 'Harry', 'William', 'Daniel', 'Michael', 'Ethan', 'Ryan', 'Chris', 'Liam', 'Noah', 'Amelia', 'Isla', 'Ava', 'Mia', 'Ella', 'Lily', 'Chloe', 'Charlotte', 'Freya', 'Evie', 'Ruby', 'Poppy', 'Alice', 'Sophia', 'Isabella', 'Abigail', 'Madison', 'Natalie', 'Rachel', 'Samantha', 'Victoria', 'Zoe', 'Hailey', 'Brooke', 'Kayla', 'Sienna', 'Harper', 'Ivy', 'Nora', 'Claire', 'George', 'Charlie', 'Thomas', 'Jacob', 'Alfie', 'Joshua', 'Henry', 'Alexander', 'Benjamin', 'Samuel', 'Matthew', 'Andrew', 'David', 'Joseph', 'Logan', 'Lucas', 'Mason', 'Aiden', 'Connor', 'Dylan', 'Tyler', 'Nathan', 'Owen', 'Patrick', 'Sean', 'Kevin', 'Brian', 'Jason', 'Justin', 'Brandon', 'Austin', 'Cameron', 'Caleb', 'Isaac', 'Luke', 'Max', 'Theo', 'Finn', 'Callum', 'Kieran', 'Declan', 'Rory', 'Hamish', 'Mitchell', 'Bailey', 'Jordan', 'Taylor', 'Riley', 'Morgan'],
    last: ['Smith', 'Johnson', 'Williams', 'Brown', 'Taylor', 'Wilson', 'Davies', 'Evans', 'Thompson', 'Walker', 'Wright', 'Robinson', 'Clarke', 'Hughes', 'Miller', 'Anderson', 'Murphy', 'Kelly', 'Campbell', 'Stewart', 'Jones', 'Roberts', 'Lewis', 'Walsh', 'White', 'Harris', 'Martin', 'Jackson', 'Wood', 'Turner', 'Hall', 'Green', 'King', 'Baker', 'Lee', 'Allen', 'Young', 'Mitchell', 'Carter', 'Phillips', 'Moore', 'Cooper', 'Ward', 'Morris', 'Watson', 'Harrison', 'Morgan', 'Edwards', 'Bennett', 'Cook', 'Bell', 'Bailey', 'Parker', 'Collins', 'Shaw', 'Russell', 'Cox', 'Graham', 'Foster', 'Gray', 'Mills', 'Ellis', 'Knight', 'Price', 'Butler', 'Barnes', 'Fisher', 'Henderson', 'Reid', 'Ross', 'Scott', 'Kennedy', 'Fraser', 'Murray', 'O\'Brien', 'Ryan', 'Byrne', 'Doyle', 'Gallagher', 'Brooks', 'Hayes', 'Sullivan', 'Bryant', 'Gordon', 'Webb', 'Chapman', 'Holmes', 'Palmer', 'Lawrence', 'Hunt', 'Black', 'Hart', 'Fox', 'Rose', 'Stone', 'Lane', 'Day', 'Burke'],
  },
  es: {
    first: ['Lucía', 'María', 'Paula', 'Valentina', 'Camila', 'Sofía', 'Isabela', 'Ana', 'Mateo', 'Santiago', 'Diego', 'Pablo', 'Javier', 'Alejandro', 'Joao', 'Pedro', 'Rafael', 'Gabriela', 'Carlos', 'Luis', 'Martina', 'Julia', 'Daniela', 'Carmen', 'Elena', 'Laura', 'Sara', 'Alba', 'Claudia', 'Irene', 'Natalia', 'Andrea', 'Mariana', 'Ximena', 'Renata', 'Fernanda', 'Catalina', 'Florencia', 'Beatriz', 'Juliana', 'Larissa', 'Inês', 'Leonor', 'Rocío', 'Pilar', 'Nuria', 'Marta', 'Teresa', 'Alma', 'Hugo', 'Martín', 'Lucas', 'Leo', 'Daniel', 'Manuel', 'Adrián', 'Álvaro', 'David', 'Sergio', 'Jorge', 'Miguel', 'Fernando', 'Andrés', 'Ricardo', 'Emiliano', 'Sebastián', 'Nicolás', 'Tomás', 'Joaquín', 'Felipe', 'Gustavo', 'Rodrigo', 'Eduardo', 'Thiago', 'Gonçalo', 'Tiago', 'Bruno', 'Vicente', 'Iker', 'Unai', 'Marcos', 'Rubén', 'Raúl', 'Óscar', 'Ignacio', 'Francisco', 'Héctor', 'Cristian', 'Esteban'],
    last: ['García', 'Rodríguez', 'González', 'Fernández', 'López', 'Martínez', 'Sánchez', 'Pérez', 'Gómez', 'Díaz', 'Silva', 'Santos', 'Oliveira', 'Souza', 'Costa', 'Ramírez', 'Torres', 'Flores', 'Rojas', 'Herrera', 'Ruiz', 'Hernández', 'Jiménez', 'Moreno', 'Muñoz', 'Álvarez', 'Romero', 'Alonso', 'Gutiérrez', 'Navarro', 'Domínguez', 'Vázquez', 'Ramos', 'Gil', 'Serrano', 'Blanco', 'Molina', 'Morales', 'Suárez', 'Ortega', 'Delgado', 'Castro', 'Ortiz', 'Rubio', 'Marín', 'Sanz', 'Iglesias', 'Medina', 'Garrido', 'Cortés', 'Castillo', 'Santana', 'Guerrero', 'Lozano', 'Cano', 'Prieto', 'Méndez', 'Cruz', 'Vargas', 'Reyes', 'Aguilar', 'Mendoza', 'Ferreira', 'Pereira', 'Almeida', 'Carvalho', 'Ribeiro', 'Lima', 'Rocha', 'Alves', 'Barbosa', 'Martins', 'Araújo', 'Fonseca', 'Salazar', 'Peña', 'Vega', 'Campos', 'Fuentes'],
  },
  de: {
    first: ['Anna', 'Lena', 'Mia', 'Laura', 'Lisa', 'Katharina', 'Jonas', 'Felix', 'Lukas', 'Leon', 'Paul', 'Maximilian', 'Tobias', 'Jan', 'Lars', 'Sven', 'Ingrid', 'Erik', 'Pieter', 'Sanne', 'Sophie', 'Marie', 'Hannah', 'Emilia', 'Lea', 'Clara', 'Johanna', 'Leonie', 'Julia', 'Sarah', 'Nele', 'Greta', 'Ida', 'Frieda', 'Charlotte', 'Paula', 'Emma', 'Lotte', 'Astrid', 'Freja', 'Maja', 'Elin', 'Saga', 'Linnea', 'Femke', 'Fleur', 'Noor', 'Eva', 'Britt', 'Karin', 'Ben', 'Finn', 'Elias', 'Noah', 'Luca', 'Henry', 'Emil', 'Anton', 'Moritz', 'Niklas', 'Julian', 'Philipp', 'Florian', 'Simon', 'David', 'Fabian', 'Sebastian', 'Matthias', 'Stefan', 'Markus', 'Thomas', 'Andreas', 'Christian', 'Daniel', 'Oskar', 'Magnus', 'Henrik', 'Mikkel', 'Mads', 'Rasmus', 'Anders', 'Bjørn', 'Olav', 'Nils', 'Gustav', 'Axel', 'Daan', 'Sem', 'Bram', 'Thijs', 'Ruben', 'Joost', 'Jeroen', 'Willem', 'Lieke'],
    last: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Hoffmann', 'Schulz', 'Koch', 'Richter', 'Klein', 'Wolf', 'de Vries', 'Jansen', 'Andersen', 'Nielsen', 'Larsen', 'Berg', 'Schäfer', 'Bauer', 'Schröder', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Krüger', 'Hofmann', 'Hartmann', 'Lange', 'Schmitt', 'Werner', 'Schmitz', 'Krause', 'Meier', 'Lehmann', 'Schmid', 'Schulze', 'Maier', 'Köhler', 'Herrmann', 'König', 'Walter', 'Mayer', 'Huber', 'Kaiser', 'Fuchs', 'Peters', 'Lang', 'Scholz', 'Möller', 'Weiß', 'Jung', 'Hahn', 'de Jong', 'van Dijk', 'Bakker', 'Visser', 'Smit', 'Meijer', 'de Boer', 'Mulder', 'de Groot', 'Bos', 'Vos', 'Hendriks', 'Johansson', 'Karlsson', 'Eriksson', 'Lindqvist', 'Hansen', 'Pedersen', 'Olsen', 'Christensen', 'Johansen', 'Virtanen', 'Korhonen', 'Nieminen'],
  },
  ar: {
    first: ['Fatima', 'Aisha', 'Mariam', 'Layla', 'Noor', 'Salma', 'Yasmin', 'Omar', 'Ahmed', 'Mohamed', 'Youssef', 'Ali', 'Khalid', 'Hassan', 'Tarek', 'Rania', 'Samir', 'Karim', 'Nadia', 'Bilal', 'Hana', 'Sara', 'Lina', 'Dina', 'Leila', 'Amira', 'Zahra', 'Huda', 'Iman', 'Malak', 'Rim', 'Sana', 'Asma', 'Meriem', 'Khadija', 'Samira', 'Lamia', 'Ines', 'Zeynep', 'Elif', 'Ayşe', 'Esra', 'Selin', 'Merve', 'Hamza', 'Ibrahim', 'Mustafa', 'Mahmoud', 'Abdallah', 'Said', 'Yassine', 'Mehdi', 'Rachid', 'Nabil', 'Walid', 'Adel', 'Faisal', 'Sultan', 'Hamad', 'Majid', 'Rashid', 'Ziad', 'Fadi', 'Amine', 'Anas', 'Idris', 'Ilyas', 'Emre', 'Burak', 'Mehmet', 'Can', 'Kerem', 'Murat', 'Ozan', 'Selim'],
    last: ['Al-Mansouri', 'Haddad', 'Khoury', 'Benali', 'El Amrani', 'Saleh', 'Nasser', 'Farouk', 'Hamdan', 'Rahman', 'Aziz', 'Mansour', 'Bakr', 'Kassem', 'Darwish', 'Yilmaz', 'Demir', 'Kaya', 'Şahin', 'Öztürk', 'Bensaid', 'Cherif', 'Bouzid', 'Mahmoud', 'Ibrahim', 'Hussein', 'Abdullah', 'Hamid', 'Suleiman', 'Qasim', 'Zayed', 'Al-Hashimi', 'Al-Farsi', 'Al-Qahtani', 'Al-Otaibi', 'Al-Shehhi', 'Bouazizi', 'Tazi', 'Alaoui', 'Bennani', 'Chraibi', 'Fassi', 'Berrada', 'Lahlou', 'Amrani', 'Belkacem', 'Bouchareb', 'Mekki', 'Khalil', 'Hijazi', 'Najjar', 'Sabbagh', 'Antoun', 'Karam', 'Aydın', 'Arslan', 'Doğan', 'Kılıç', 'Aslan', 'Çelik', 'Koç', 'Kurt', 'Özdemir', 'Polat'],
  },
  af: {
    first: ['Amara', 'Ngozi', 'Chiamaka', 'Aminata', 'Fatou', 'Zainab', 'Thandiwe', 'Adaeze', 'Kwame', 'Kofi', 'Chinedu', 'Tunde', 'Moussa', 'Ibrahima', 'Sipho', 'Abebe', 'Oluwaseun', 'Mamadou', 'Awa', 'Yaw', 'Ama', 'Akosua', 'Efua', 'Adwoa', 'Abena', 'Chioma', 'Ifeoma', 'Nneka', 'Folake', 'Yetunde', 'Funmi', 'Bisi', 'Wanjiru', 'Njeri', 'Akinyi', 'Zodwa', 'Lindiwe', 'Nomvula', 'Naledi', 'Ayana', 'Makeda', 'Saba', 'Hawa', 'Mariama', 'Kadiatou', 'Khady', 'Binta', 'Rokia', 'Oumou', 'Esi', 'Kojo', 'Kwesi', 'Kwabena', 'Emeka', 'Obinna', 'Ikenna', 'Uchenna', 'Babatunde', 'Segun', 'Femi', 'Kunle', 'Kamau', 'Otieno', 'Odhiambo', 'Thabo', 'Bongani', 'Themba', 'Mandla', 'Tendai', 'Tafadzwa', 'Chipo', 'Dawit', 'Yonas', 'Seydou', 'Boubacar', 'Ousmane', 'Cheikh', 'Abdoulaye', 'Lamine', 'Souleymane'],
    last: ['Okafor', 'Adeyemi', 'Mensah', 'Diallo', 'Traoré', 'Ndiaye', 'Mbeki', 'Okonkwo', 'Asante', 'Kamara', 'Diop', 'Keita', 'Banda', 'Mwangi', 'Tesfaye', 'Nkosi', 'Coulibaly', 'Sow', 'Boateng', 'Eze', 'Owusu', 'Agyeman', 'Appiah', 'Ofori', 'Boakye', 'Adeleke', 'Balogun', 'Ogunleye', 'Nwosu', 'Obi', 'Chukwu', 'Okeke', 'Ibe', 'Kariuki', 'Ochieng', 'Wanjiku', 'Kipchoge', 'Dlamini', 'Ndlovu', 'Khumalo', 'Zulu', 'Mokoena', 'Moyo', 'Ncube', 'Phiri', 'Tembo', 'Haile', 'Bekele', 'Gebre', 'Alemu', 'Sylla', 'Camara', 'Bah', 'Barry', 'Cissé', 'Konaté', 'Touré', 'Fofana', 'Sanogo', 'Ouattara', 'Kaboré', 'Sawadogo', 'Mbaye', 'Faye', 'Gueye', 'Sarr'],
  },
  in: {
    first: ['Priya', 'Ananya', 'Aditi', 'Kavya', 'Neha', 'Divya', 'Sneha', 'Arjun', 'Rohan', 'Vikram', 'Rahul', 'Aditya', 'Karan', 'Siddharth', 'Imran', 'Farhan', 'Ayesha', 'Ravi', 'Sanjay', 'Meera', 'Isha', 'Pooja', 'Riya', 'Shreya', 'Tanvi', 'Kriti', 'Nisha', 'Anjali', 'Lakshmi', 'Deepa', 'Shalini', 'Swati', 'Pallavi', 'Aarti', 'Rekha', 'Sunita', 'Kiran', 'Jaya', 'Radha', 'Sita', 'Aarav', 'Vihaan', 'Ishaan', 'Reyansh', 'Kabir', 'Dev', 'Aryan', 'Nikhil', 'Varun', 'Akash', 'Amit', 'Rajesh', 'Suresh', 'Manish', 'Deepak', 'Anil', 'Vijay', 'Ajay', 'Harsh', 'Yash', 'Pranav', 'Abhishek', 'Gaurav', 'Rohit', 'Tarun', 'Kunal', 'Neeraj', 'Zain', 'Hamza', 'Bilal', 'Fahad', 'Usman', 'Asif'],
    last: ['Sharma', 'Patel', 'Singh', 'Kumar', 'Gupta', 'Reddy', 'Iyer', 'Nair', 'Mehta', 'Joshi', 'Das', 'Chopra', 'Rao', 'Khan', 'Malik', 'Ahmed', 'Bose', 'Menon', 'Verma', 'Kapoor', 'Agarwal', 'Bhatt', 'Desai', 'Dutta', 'Ghosh', 'Jain', 'Kulkarni', 'Mishra', 'Mukherjee', 'Pandey', 'Pillai', 'Saxena', 'Shah', 'Sinha', 'Srivastava', 'Thakur', 'Tiwari', 'Trivedi', 'Yadav', 'Banerjee', 'Chatterjee', 'Chaudhary', 'Dubey', 'Goswami', 'Hegde', 'Kaur', 'Gill', 'Sandhu', 'Sethi', 'Bhatia', 'Arora', 'Kohli', 'Qureshi', 'Siddiqui', 'Hussain', 'Chaudhry', 'Butt', 'Perera', 'Fernando', 'Silva'],
  },
  ea: {
    first: ['Mei', 'Yuki', 'Hana', 'Sakura', 'Ji-woo', 'Min-ji', 'Lan', 'Linh', 'Wei', 'Hao', 'Jun', 'Hiroshi', 'Kenji', 'Takumi', 'Min-jun', 'Seo-yeon', 'Bao', 'Siti', 'Arif', 'Nattapong', 'Xiu', 'Ling', 'Yan', 'Fang', 'Jing', 'Hui', 'Ying', 'Xin', 'Aiko', 'Haruka', 'Mio', 'Rin', 'Yui', 'Nanami', 'Ayaka', 'Misaki', 'Seo-ah', 'Ha-eun', 'Ji-yeon', 'Soo-ah', 'Mai', 'Thao', 'Trang', 'Anh', 'Putri', 'Dewi', 'Ayu', 'Nurul', 'Mei Ling', 'Pim', 'Ming', 'Lei', 'Tao', 'Feng', 'Bo', 'Chen', 'Yi', 'Kai', 'Daichi', 'Haruto', 'Ren', 'Sota', 'Yuto', 'Riku', 'Kaito', 'Shota', 'Ji-ho', 'Do-yun', 'Seo-jun', 'Ha-joon', 'Hyun-woo', 'Minh', 'Duc', 'Quang', 'Tuan', 'Budi', 'Agus', 'Rizky', 'Somchai', 'Anan', 'Jose', 'Mark', 'Paolo', 'Wei Jie'],
    last: ['Wang', 'Li', 'Zhang', 'Liu', 'Chen', 'Yang', 'Huang', 'Zhao', 'Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Kim', 'Lee', 'Park', 'Nguyen', 'Tran', 'Santoso', 'Wongsakul', 'Tan', 'Wu', 'Zhou', 'Xu', 'Sun', 'Ma', 'Zhu', 'Hu', 'Guo', 'He', 'Lin', 'Luo', 'Gao', 'Zheng', 'Liang', 'Xie', 'Song', 'Tang', 'Han', 'Feng', 'Deng', 'Ito', 'Watanabe', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Yoshida', 'Yamada', 'Sasaki', 'Matsumoto', 'Inoue', 'Kimura', 'Hayashi', 'Shimizu', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon', 'Jang', 'Lim', 'Shin', 'Pham', 'Hoang', 'Phan', 'Vu', 'Dang', 'Bui', 'Do', 'Wijaya', 'Halim', 'Gunawan', 'Ong', 'Goh', 'Chua', 'Reyes', 'Cruz', 'Bautista', 'Ocampo', 'Rattanakorn', 'Srisuk'],
  },
  ru: {
    first: ['Anastasia', 'Maria', 'Daria', 'Olga', 'Elena', 'Natalia', 'Ivan', 'Dmitri', 'Alexei', 'Sergei', 'Nikolai', 'Andrei', 'Mikhail', 'Pavel', 'Katarzyna', 'Piotr', 'Tomasz', 'Ioana', 'Yulia', 'Ekaterina', 'Tatiana', 'Irina', 'Svetlana', 'Anna', 'Ksenia', 'Polina', 'Alina', 'Sofia', 'Viktoria', 'Valeria', 'Kristina', 'Veronika', 'Alisa', 'Arina', 'Vera', 'Lyudmila', 'Galina', 'Oksana', 'Iryna', 'Agnieszka', 'Magdalena', 'Zofia', 'Ewa', 'Petra', 'Lucie', 'Tereza', 'Eszter', 'Réka', 'Ana', 'Mihaela', 'Ivana', 'Milena', 'Aleksandr', 'Maxim', 'Artem', 'Kirill', 'Egor', 'Roman', 'Vladimir', 'Yuri', 'Oleg', 'Viktor', 'Konstantin', 'Denis', 'Stanislav', 'Boris', 'Fedor', 'Gleb', 'Timur', 'Ruslan', 'Taras', 'Bohdan', 'Marek', 'Jakub', 'Krzysztof', 'Michał', 'Łukasz', 'Ondřej', 'Lukáš', 'Bence', 'Levente', 'Gábor', 'Mihai', 'Bogdan', 'Stefan', 'Luka', 'Nikola', 'Marko', 'Arman', 'Nursultan'],
    last: ['Ivanov', 'Smirnov', 'Kuznetsov', 'Popov', 'Volkov', 'Sokolov', 'Lebedev', 'Kozlov', 'Novak', 'Kowalski', 'Nowak', 'Wiśniewski', 'Popescu', 'Ionescu', 'Horváth', 'Kovač', 'Petrov', 'Shevchenko', 'Bondarenko', 'Dvořák', 'Morozov', 'Volkova', 'Fedorov', 'Mikhailov', 'Novikov', 'Pavlov', 'Semenov', 'Egorov', 'Orlov', 'Zaitsev', 'Solovyov', 'Vasiliev', 'Belov', 'Komarov', 'Tarasov', 'Medvedev', 'Antonov', 'Nikitin', 'Zakharov', 'Romanov', 'Melnyk', 'Kovalenko', 'Tkachenko', 'Kravchenko', 'Lewandowski', 'Wójcik', 'Kamiński', 'Zieliński', 'Szymański', 'Woźniak', 'Dąbrowski', 'Novák', 'Svoboda', 'Novotný', 'Černý', 'Procházka', 'Nagy', 'Tóth', 'Szabó', 'Kiss', 'Popa', 'Radu', 'Stan', 'Dumitru', 'Ivanova', 'Dimitrov', 'Georgiev', 'Horvat', 'Kovačević', 'Jovanović', 'Petrović', 'Nikolić', 'Babić', 'Nurlanov', 'Abenov'],
  },
};

/** Pays parlant ces langues ou de ces régions (sinon on se sert du continent). */
const COUNTRY_POOL: Record<string, string> = {
  FR: 'fr', BE: 'fr', CH: 'fr', LU: 'fr', MC: 'fr', SN: 'af', CI: 'af', CM: 'af', ML: 'af', MG: 'af', RE: 'fr', GP: 'fr', MQ: 'fr', GF: 'fr', PF: 'fr', NC: 'fr', HT: 'fr', CA: 'en',
  US: 'en', GB: 'en', IE: 'en', AU: 'en', NZ: 'en', ZA: 'af', NG: 'af', GH: 'af', KE: 'af', ET: 'af',
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es', BR: 'es', PT: 'es', VE: 'es', EC: 'es', CU: 'es', DO: 'es',
  DE: 'de', AT: 'de', NL: 'de', DK: 'de', SE: 'de', NO: 'de', FI: 'de', IS: 'de',
  MA: 'ar', DZ: 'ar', TN: 'ar', EG: 'ar', SA: 'ar', AE: 'ar', QA: 'ar', KW: 'ar', OM: 'ar', JO: 'ar', LB: 'ar', TR: 'ar', IQ: 'ar', BH: 'ar',
  IN: 'in', PK: 'in', BD: 'in', LK: 'in', NP: 'in',
  CN: 'ea', JP: 'ea', KR: 'ea', TW: 'ea', HK: 'ea', VN: 'ea', TH: 'ea', ID: 'ea', MY: 'ea', SG: 'ea', PH: 'ea',
  RU: 'ru', UA: 'ru', PL: 'ru', CZ: 'ru', RO: 'ru', HU: 'ru', BG: 'ru', HR: 'ru', RS: 'ru', SK: 'ru', BY: 'ru', KZ: 'ru',
};

const CONTINENT_POOL: Record<string, string> = { EU: 'de', AF: 'af', AS: 'ea', NA: 'en', SA: 'es', OC: 'en' };

export function namePoolFor(country: string, continent: string | undefined): string {
  return COUNTRY_POOL[country] ?? CONTINENT_POOL[continent ?? ''] ?? 'en';
}

/**
 * Prénom et nom au hasard. `avoid` : prénoms déjà portés (pilotes, candidats),
 * évités tant que c'est possible pour ne pas recruter trois « Lucas ».
 */
export function randomName(rng: Rng, pool: string, avoid?: Set<string>): { firstName: string; lastName: string } {
  const p = POOLS[pool] ?? POOLS.en;
  let firstName = pick(rng, p.first);
  for (let i = 0; i < 12 && avoid?.has(firstName); i++) firstName = pick(rng, p.first);
  let lastName = pick(rng, p.last);
  // Certains prénoms sont aussi des noms de famille : pas de « Thomas Thomas ».
  for (let i = 0; i < 5 && lastName === firstName; i++) lastName = pick(rng, p.last);
  return { firstName, lastName };
}

// ───────────────────────── Immatriculations ─────────────────────────

/** Préfixes d'immatriculation (OACI) des principaux pays. */
const REG_PREFIX: Record<string, string> = {
  FR: 'F-', US: 'N', GB: 'G-', DE: 'D-', ES: 'EC-', IT: 'I-', PT: 'CS-', BE: 'OO-', NL: 'PH-', CH: 'HB-', AT: 'OE-', IE: 'EI-', LU: 'LX-',
  DK: 'OY-', SE: 'SE-', NO: 'LN-', FI: 'OH-', IS: 'TF-', PL: 'SP-', CZ: 'OK-', GR: 'SX-', TR: 'TC-', RU: 'RA-', UA: 'UR-', RO: 'YR-', HU: 'HA-',
  CA: 'C-', MX: 'XA-', BR: 'PR-', AR: 'LV-', CL: 'CC-', CO: 'HK-', PE: 'OB-', CN: 'B-', JP: 'JA', KR: 'HL', TW: 'B-', HK: 'B-', IN: 'VT-',
  AU: 'VH-', NZ: 'ZK-', ZA: 'ZS-', EG: 'SU-', MA: 'CN-', DZ: '7T-', TN: 'TS-', SN: '6V-', NG: '5N-', KE: '5Y-', ET: 'ET-', AE: 'A6-',
  QA: 'A7-', SA: 'HZ-', IL: '4X-', SG: '9V-', MY: '9M-', TH: 'HS-', ID: 'PK-', PH: 'RP-', VN: 'VN-', PK: 'AP-',
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function letters(rng: Rng, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += LETTERS[Math.floor(rng() * 26)];
  return s;
}

/** Nouvelle immatriculation, différente de celles déjà utilisées. */
export function randomRegistration(rng: Rng, country: string, taken: Set<string>): string {
  const prefix = REG_PREFIX[country] ?? `${country}-`;
  for (let i = 0; i < 1000; i++) {
    let reg: string;
    if (prefix === 'N') reg = `N${randInt(rng, 100, 999)}${letters(rng, 2)}`;
    else if (prefix === 'JA') reg = `JA${randInt(rng, 100, 999)}${letters(rng, 1)}`;
    else if (prefix === 'HL' || prefix === 'B-') reg = `${prefix}${randInt(rng, 1000, 9999)}`;
    else reg = `${prefix}${letters(rng, prefix.length >= 4 ? 3 : 4)}`;
    if (!taken.has(reg)) return reg;
  }
  return `${prefix}${Date.now() % 100000}`;
}
