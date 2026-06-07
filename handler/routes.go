package handler

import (
	"testing-app/config"
	"testing-app/middleware"
	"testing-app/notify"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
)

func NewRouter(pool *pgxpool.Pool, cfg *config.Config, n notify.Sender) *gin.Engine {
	r := gin.Default()
	r.Static("/static", "./static")
	r.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.CORSOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		AllowCredentials: true,
	}))

	auth := NewAuthHandler(pool, cfg, n)
	users := NewUserHandler(pool, cfg)
	activity := NewActivityHandler(pool)
	groups := NewGroupHandler(pool, cfg)
	lessons := NewLessonHandler(pool, cfg)
	tests := NewTestHandler(pool, cfg)
	ent := NewENTHandler(pool, cfg)
	tg := NewTelegramHandler(pool, cfg, n)
	topicH := NewTopicHandler(pool)

	v1 := r.Group("/api/v1")

	// Telegram bot webhook (public, called by Telegram servers)
	r.POST("/telegram/webhook", tg.Webhook)

	// Health check (public, no auth)
	v1.GET("/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Публичные маршруты
	a := v1.Group("/auth")
	{
		a.POST("/send-otp", auth.SendOTP)
		a.POST("/register", auth.Register)
		a.POST("/login", auth.Login)
		a.POST("/login/otp", auth.LoginOTP)
		a.POST("/refresh", auth.Refresh)
		a.POST("/reset-password", auth.ResetPassword)
		a.GET("/config", tg.AuthConfig)
	}

	// Защищённые маршруты
	secure := v1.Group("/", middleware.JWT(cfg.JWT.AccessSecret))
	{
		secure.POST("/auth/logout", auth.Logout)

		// Профиль
		secure.GET("/users/me", users.GetMe)
		secure.PUT("/users/me", users.UpdateMe)
		secure.PATCH("/users/me", users.UpdateMe)
		secure.PUT("/users/me/password", users.SetPassword)
		secure.POST("/users/me/password", users.SetPassword)
		secure.PUT("/users/me/phone", users.UpdatePhone)
		secure.POST("/users/me/avatar", users.UploadAvatar)
		secure.GET("/users/me/activity", activity.GetActivity)

		// Группы (только учитель — создание и управление студентами)
		teacher := secure.Group("/", middleware.RequireRole("teacher"))
		{
			teacher.POST("/groups", groups.Create)
			teacher.GET("/groups", groups.ListMine)
			teacher.POST("/groups/:id/students", groups.AddStudent)
			teacher.DELETE("/groups/:id/students/:user_id", groups.RemoveStudent)
			teacher.POST("/groups/:id/lessons", lessons.Create)
			teacher.PUT("/lessons/:id", lessons.Update)
			teacher.PUT("/lessons/:id/topics", lessons.UpdateTopics)
			teacher.DELETE("/lessons/:id", lessons.Delete)
		}
		secure.GET("/groups/joined", groups.ListJoined)
		secure.POST("/groups/join", groups.JoinGroup)
		secure.DELETE("/groups/:id/leave", groups.LeaveGroup)
		secure.GET("/groups/:id", groups.Get)
		secure.GET("/groups/:id/students", groups.ListStudents)
		secure.POST("/upload/image", UploadImage)
		teacher.POST("/questions/import", ImportQuestionsFromFile)
		teacher.POST("/questions/parse-text", ParseQuestionsFromText)

		// Уроки — просмотр (все авторизованные)
		secure.GET("/groups/:id/lessons", lessons.List)
		secure.GET("/lessons/:id", lessons.Get)
		secure.GET("/lessons/:id/blocks", lessons.ListBlocks)
		secure.POST("/lessons/:id/view", lessons.RecordView)
		secure.GET("/lessons/available", lessons.ListAvailable)

		// Уроки — управление (только учитель)
		teacher.GET("/lessons/mine", lessons.ListMine)
		teacher.POST("/lessons", lessons.Create)
		teacher.POST("/lessons/:id/publish", lessons.Publish)
		teacher.POST("/lessons/:id/unpublish", lessons.Unpublish)
		teacher.POST("/lessons/:id/blocks", lessons.CreateBlock)
		teacher.PUT("/lesson-blocks/:blockId", lessons.UpdateBlock)
		teacher.DELETE("/lesson-blocks/:blockId", lessons.DeleteBlock)
		teacher.POST("/lessons/:id/blocks/reorder", lessons.ReorderBlocks)
		teacher.GET("/lessons/:id/viewers", lessons.ListViewers)
		teacher.GET("/lessons/:id/access", lessons.ListAccess)
		teacher.POST("/lessons/:id/access", lessons.GrantAccess)
		teacher.DELETE("/lessons/:id/access/:type/:refId", lessons.RevokeAccess)

		// Тесты — просмотр (все авторизованные)
		secure.GET("/groups/:id/tests", tests.ListTests)
		secure.GET("/tests/public", tests.ListPublicTests)
		secure.GET("/tests/:id", tests.GetTestFull)

		// Тесты — управление (только учитель)
		teacher.GET("/tests/mine", tests.ListMyTests)
		teacher.GET("/tests/:id/results", tests.GetTestResults)
		teacher.POST("/tests", tests.CreateTest)
		teacher.POST("/groups/:id/tests", tests.CreateTest)
		teacher.PUT("/tests/:id", tests.UpdateTest)
		teacher.POST("/tests/:id/publish", tests.PublishTest)
		teacher.DELETE("/tests/:id", tests.DeleteTest)
		teacher.POST("/tests/:id/questions", tests.CreateQuestion)
		teacher.POST("/tests/:id/questions/link", tests.LinkQuestionToTest)
		teacher.DELETE("/tests/:id/questions/:qid", tests.UnlinkQuestionFromTest)
		teacher.POST("/questions", tests.CreateBankQuestion)
		teacher.GET("/questions/mine", tests.ListMyQuestions)
		teacher.PUT("/questions/:id", tests.UpdateQuestion)
		teacher.DELETE("/questions/:id", tests.DeleteQuestion)
		teacher.POST("/question-contexts", tests.CreateContextQuestions)
		teacher.GET("/question-contexts/mine", tests.ListMyContexts)
		teacher.DELETE("/question-contexts/:id", tests.DeleteContext)
		teacher.POST("/questions/:id/options", tests.CreateOption)
		teacher.PUT("/options/:id", tests.UpdateOption)
		teacher.DELETE("/options/:id", tests.DeleteOption)
		secure.GET("/topics", tests.ListTopics)
		teacher.POST("/topics", tests.CreateTopic)
		secure.GET("/topics/:id/subtopics", tests.ListSubtopics)
		teacher.POST("/topics/:id/subtopics", tests.CreateSubtopic)
		secure.GET("/topics/:id/tests", topicH.ListTests)
		secure.POST("/topics/:id/random-test", topicH.StartRandomTest)

		// Прохождение тестов (студент)
		secure.POST("/tests/:id/attempts", tests.StartAttempt)
		secure.POST("/attempts/:id/answer", tests.SubmitAnswer)
		secure.POST("/attempts/:id/finish", tests.FinishAttempt)
		secure.GET("/attempts/:id/review", tests.AttemptReview)
		secure.GET("/attempts/my", tests.ListMyAttempts)

		// ЕНТ авто-квиз
		secure.POST("/ent/start", ent.Start)
		secure.GET("/ent/attempts/my", ent.ListMine)
		secure.GET("/ent/attempts/:id", ent.GetAttempt)
		secure.POST("/ent/attempts/:id/answer", ent.SaveAnswer)
		secure.POST("/ent/attempts/:id/finish", ent.Finish)
		secure.GET("/ent/attempts/:id/result", ent.GetResult)
	}

	return r
}
